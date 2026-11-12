const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const router = express.Router();
const FinalSettlement = require('../models/hr/FinalSettlement');
const Employee = require('../models/hr/Employee');
const Loan = require('../models/hr/Loan');
const { authMiddleware } = require('../middleware/auth');
const { checkPermission } = require('../middleware/permissions');
const { isDesignatedCeoApprover } = require('../utils/executiveAccess');
const PlacementCompany = require('../models/hr/Company');
const { postFinalSettlementToFinance, syncFinalSettlementPayments, syncSettlementDocumentsToBill } = require('../utils/finalSettlementFinance');

// ─── Attachments (PDF / image / Word / Excel, 10 MB each, up to 10 at a time) — same rules as loans ───
const settlementUploadDir = path.join(__dirname, '../uploads/final-settlements');
const ALLOWED_ATTACHMENT_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
];
const settlementUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      if (!fs.existsSync(settlementUploadDir)) fs.mkdirSync(settlementUploadDir, { recursive: true });
      cb(null, settlementUploadDir);
    },
    filename: (req, file, cb) => {
      cb(null, `settlement-${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname).toLowerCase()}`);
    }
  }),
  limits: { fileSize: 10 * 1024 * 1024, files: 10 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/') || ALLOWED_ATTACHMENT_TYPES.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Attachments must be PDF, image, Word or Excel files'), false);
  }
});
const handleSettlementUpload = (req, res, next) => {
  settlementUpload.array('attachments', 10)(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ message: 'Each attachment must be 10 MB or less' });
    if (err.code === 'LIMIT_FILE_COUNT') return res.status(400).json({ message: 'Maximum 10 attachments at a time' });
    return res.status(400).json({ message: err.message || 'File upload error' });
  });
};
const removeUploadedFiles = (files = []) => files.forEach((f) => fs.unlink(f.path, () => {}));
const settlementDocuments = async (id) => {
  const data = await FinalSettlement.findById(id).select('documents').populate('documents.uploadedBy', 'firstName lastName').lean();
  return data?.documents || [];
};

/** Validate a company id from the form → { companyId, companyName } (throws 400 when missing / unknown) */
const resolveSettlementCompany = async (companyId) => {
  if (!companyId || !require('mongoose').Types.ObjectId.isValid(String(companyId))) {
    throw Object.assign(new Error('Select the company for this settlement'), { statusCode: 400 });
  }
  const company = await PlacementCompany.findById(companyId).select('name').lean();
  if (!company) throw Object.assign(new Error('Selected company not found'), { statusCode: 400 });
  return { companyId: company._id, companyName: company.name };
};

// ─── Approval workflow (same as Manual Salary): HR forwards → GM HR → AVP → CEO → "approved" ───
const ADMIN_ROLES = ['super_admin', 'admin', 'developer'];
const isAdminUser = (user) => ADMIN_ROLES.includes(user?.role);
const IN_APPROVAL = ['Pending HOD HR', 'Pending AVP', 'Forwarded to CEO'];
const FORWARDABLE = ['Draft', 'Returned', 'Rejected by CEO'];
const APPROVER_FIELDS = ['forwardedBy', 'assignedHod', 'hodApprovedBy', 'assignedAvp', 'avpApprovedBy', 'ceoApprovedBy', 'returnedBy'];
const approverPopulate = APPROVER_FIELDS.map((path) => ({ path, select: 'firstName lastName email' }));
const sameUser = (a, b) => Boolean(a && b) && String(a._id || a) === String(b._id || b);

/** Which step the user can act on: 'HOD' | 'AVP' | 'CEO' | null */
const workflowRoleFor = (settlement, user) => {
  const ws = settlement.workflowStatus || 'Draft';
  if (ws === 'Pending HOD HR' && (sameUser(settlement.assignedHod, user._id) || isAdminUser(user))) return 'HOD';
  if (ws === 'Pending AVP' && (sameUser(settlement.assignedAvp, user._id) || isAdminUser(user))) return 'AVP';
  if (ws === 'Forwarded to CEO' && isDesignatedCeoApprover(user)) return 'CEO';
  return null;
};
const {
  resolveSettlementRateDate,
  getSettlementDailyRate,
  getSettlementShortfallDeduction,
  getSettlementActualSalary
} = require('../utils/finalSettlementDays');

/** "Salary for month" lines typed by HR: valid month/year with an amount above zero */
const cleanMonthSalaries = (rows) => (Array.isArray(rows) ? rows : [])
  .map((row) => ({
    month: parseInt(row?.month, 10),
    year: parseInt(row?.year, 10),
    amount: Math.round((Number(row?.amount) || 0) * 100) / 100,
    note: String(row?.note || '').trim().slice(0, 200)
  }))
  .filter((row) => row.month >= 1 && row.month <= 12 && row.year >= 2000 && row.amount > 0);

// Get all final settlements with pagination and filters
router.get('/', authMiddleware, async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      status,
      settlementType,
      department,
      search,
      startDate,
      endDate
    } = req.query;

    const query = {};

    // Add filters
    if (status) query.status = status;
    if (settlementType) query.settlementType = settlementType;
    if (department) query.department = department;

    // Date range filter
    if (startDate || endDate) {
      query.settlementDate = {};
      if (startDate) query.settlementDate.$gte = new Date(startDate);
      if (endDate) query.settlementDate.$lte = new Date(endDate);
    }

    // Search filter
    if (search) {
      query.$or = [
        { employeeName: { $regex: search, $options: 'i' } },
        { employeeId: { $regex: search, $options: 'i' } },
        { reason: { $regex: search, $options: 'i' } }
      ];
    }

    const options = {
      page: parseInt(page),
      limit: parseInt(limit),
      populate: [
        { path: 'employee', select: 'employeeId name department designation' },
        { path: 'approvedBy', select: 'firstName lastName email' },
        { path: 'processedBy', select: 'firstName lastName email' },
        ...approverPopulate
      ],
      sort: { createdAt: -1 }
    };

    const settlements = await FinalSettlement.paginate(query, options);
    await syncFinalSettlementPayments(settlements.docs).catch((e) => console.error('Settlement payment sync failed:', e.message));

    // Add virtual fields to each document
    settlements.docs = settlements.docs.map(doc => {
      const settlement = doc.toObject();
      settlement.settlementProgress = settlement.settlementProgress;
      settlement.noticePeriodShortfallDays = settlement.noticePeriodShortfallDays;
      settlement.totalOutstandingLoans = settlement.totalOutstandingLoans;
      settlement.myWorkflowRole = workflowRoleFor(settlement, req.user);
      return settlement;
    });

    res.json({
      success: true,
      data: settlements
    });
  } catch (error) {
    console.error('Error fetching settlements:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching settlements',
      error: error.message
    });
  }
});

// Get settlement statistics
router.get('/stats/overview', authMiddleware, async (req, res) => {
  try {
    const stats = await FinalSettlement.getSettlementStats();
    
    // Get recent settlements
    const recentSettlements = await FinalSettlement.find()
      .sort({ createdAt: -1 })
      .limit(5)
      .populate('employee', 'employeeId name');

    // Get settlements by type
    const settlementsByType = await FinalSettlement.aggregate([
      {
        $group: {
          _id: '$settlementType',
          count: { $sum: 1 },
          totalAmount: { $sum: '$netSettlementAmount' }
        }
      }
    ]);

    // Get settlements by department
    const settlementsByDepartment = await FinalSettlement.aggregate([
      {
        $group: {
          _id: '$department',
          count: { $sum: 1 },
          totalAmount: { $sum: '$netSettlementAmount' }
        }
      }
    ]);

    res.json({
      success: true,
      data: {
        overview: stats,
        recentSettlements,
        settlementsByType,
        settlementsByDepartment
      }
    });
  } catch (error) {
    console.error('Error fetching settlement stats:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching settlement statistics',
      error: error.message
    });
  }
});

// Get employee settlements
router.get('/employee/:employeeId', authMiddleware, async (req, res) => {
  try {
    const { employeeId } = req.params;
    
    const settlements = await FinalSettlement.find({ employeeId })
      .populate('employee', 'employeeId name department designation')
      .populate('approvedBy', 'name')
      .populate('processedBy', 'name')
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      data: settlements
    });
  } catch (error) {
    console.error('Error fetching employee settlements:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching employee settlements',
      error: error.message
    });
  }
});

// Get settlement by ID
// @route   GET /api/final-settlements/workflow/me — what the current user may do in the approval workflow
router.get('/workflow/me', authMiddleware, (req, res) => {
  res.json({ success: true, data: { isCeoApprover: isDesignatedCeoApprover(req.user), isAdmin: isAdminUser(req.user) } });
});

// @route   PUT /api/final-settlements/:id/forward — HR forwards to GM HR → AVP → CEO
router.put('/:id/forward', authMiddleware, checkPermission('settlement_management'), async (req, res) => {
  try {
    const settlement = await FinalSettlement.findById(req.params.id);
    if (!settlement) return res.status(404).json({ success: false, message: 'Settlement not found' });
    if (settlement.status !== 'pending' || !FORWARDABLE.includes(settlement.workflowStatus || 'Draft')) {
      return res.status(400).json({ success: false, message: `Cannot forward while status is ${settlement.workflowStatus || settlement.status}` });
    }
    const { assignedHod, assignedAvp } = req.body || {};
    if (!assignedHod || !assignedAvp) {
      return res.status(400).json({ success: false, message: 'Select the GM HR and the AVP who will approve this settlement.' });
    }
    settlement.assignedHod = assignedHod;
    settlement.assignedAvp = assignedAvp;
    settlement.forwardedBy = req.user._id;
    settlement.forwardedAt = new Date();
    settlement.workflowStatus = 'Pending HOD HR';
    ['hodApprovedBy', 'hodApprovedAt', 'hodComments', 'avpApprovedBy', 'avpApprovedAt', 'avpComments',
      'ceoApprovedBy', 'ceoApprovedAt', 'ceoComments'].forEach((k) => { settlement[k] = undefined; });
    settlement.updatedBy = req.user._id;
    await settlement.save();
    const data = await FinalSettlement.findById(settlement._id).populate(approverPopulate).lean();
    res.json({ success: true, message: 'Settlement forwarded to GM HR for approval', data });
  } catch (error) {
    console.error('Error forwarding settlement:', error);
    res.status(500).json({ success: false, message: 'Error forwarding settlement', error: error.message });
  }
});

// @route   PUT /api/final-settlements/:id/workflow — { action: 'approve' | 'return', comments }
router.put('/:id/workflow', authMiddleware, async (req, res) => {
  try {
    const settlement = await FinalSettlement.findById(req.params.id);
    if (!settlement) return res.status(404).json({ success: false, message: 'Settlement not found' });
    const action = String(req.body?.action || '');
    const comments = String(req.body?.comments || '').trim();
    if (!['approve', 'return'].includes(action)) {
      return res.status(400).json({ success: false, message: 'Action must be approve or return' });
    }
    if (action === 'return' && !comments) {
      return res.status(400).json({ success: false, message: 'Comments are required to return a settlement' });
    }
    const role = workflowRoleFor(settlement, req.user);
    if (!role) {
      return res.status(403).json({ success: false, message: 'You are not the current approver for this settlement' });
    }
    const now = new Date();
    if (action === 'return') {
      settlement.workflowStatus = 'Returned';
      settlement.returnedBy = req.user._id;
      settlement.returnedAt = now;
      settlement.returnComments = `${role === 'HOD' ? 'GM HR' : role}: ${comments}`;
    } else if (role === 'HOD') {
      Object.assign(settlement, { workflowStatus: 'Pending AVP', hodApprovedBy: req.user._id, hodApprovedAt: now, hodComments: comments });
    } else if (role === 'AVP') {
      Object.assign(settlement, { workflowStatus: 'Forwarded to CEO', avpApprovedBy: req.user._id, avpApprovedAt: now, avpComments: comments });
    } else {
      // CEO approval completes the workflow → existing Process / Paid steps follow
      Object.assign(settlement, {
        workflowStatus: 'Approved by CEO',
        ceoApprovedBy: req.user._id,
        ceoApprovedAt: now,
        ceoComments: comments,
        status: 'approved',
        approvedBy: req.user._id,
        approvalDate: now
      });
    }
    settlement.updatedBy = req.user._id;
    await settlement.save();
    // CEO approval sends the settlement to Finance (Payables) as a bill payable to the employee
    let financeNote = '';
    if (settlement.workflowStatus === 'Approved by CEO') {
      const fin = await postFinalSettlementToFinance(settlement, req.user);
      financeNote = fin.posted
        ? ` and sent to Finance (bill ${fin.billNumber})`
        : ` — could not send to Finance: ${fin.error}`;
    }
    const data = await FinalSettlement.findById(settlement._id).populate(approverPopulate).lean();
    const next = { 'Pending AVP': 'sent to AVP', 'Forwarded to CEO': 'forwarded to CEO', 'Approved by CEO': 'approved by CEO', 'Pending Finance': 'approved by CEO', Returned: 'returned to HR' };
    res.json({ success: true, message: `Settlement ${next[settlement.workflowStatus] || 'updated'}${financeNote}`, data });
  } catch (error) {
    console.error('Error in settlement workflow:', error);
    res.status(500).json({ success: false, message: 'Error updating settlement workflow', error: error.message });
  }
});

// @route   PUT /api/final-settlements/:id/send-to-finance — (re)send a CEO-approved settlement to Finance Payables
router.put('/:id/send-to-finance', authMiddleware, checkPermission('settlement_management'), async (req, res) => {
  try {
    const settlement = await FinalSettlement.findById(req.params.id);
    if (!settlement) return res.status(404).json({ success: false, message: 'Settlement not found' });
    if (settlement.financeApBillId && settlement.workflowStatus === 'Pending Finance') {
      return res.status(400).json({ success: false, message: `Already in Finance (bill ${settlement.financeApBillNumber})` });
    }
    // Settlements approved before the company field existed pick their company here
    if (req.body?.companyId) {
      try {
        Object.assign(settlement, await resolveSettlementCompany(req.body.companyId));
      } catch (err) {
        return res.status(err.statusCode || 400).json({ success: false, message: err.message });
      }
    }
    const fin = await postFinalSettlementToFinance(settlement, req.user);
    if (!fin.posted) return res.status(fin.statusCode || 400).json({ success: false, message: fin.error });
    const data = await FinalSettlement.findById(settlement._id).populate(approverPopulate).lean();
    res.json({ success: true, message: `Sent to Finance — bill ${fin.billNumber} is in Payables`, data });
  } catch (error) {
    console.error('Error sending settlement to Finance:', error);
    res.status(500).json({ success: false, message: 'Error sending settlement to Finance', error: error.message });
  }
});

// @route   POST /api/final-settlements/:id/documents — add attachments (multipart field "attachments")
router.post('/:id/documents', authMiddleware, checkPermission('settlement_management'), handleSettlementUpload, async (req, res) => {
  const files = req.files || [];
  try {
    const settlement = await FinalSettlement.findById(req.params.id);
    if (!settlement) { removeUploadedFiles(files); return res.status(404).json({ message: 'Settlement not found' }); }
    if (!files.length) return res.status(400).json({ message: 'Choose at least one file to attach' });
    // While an approver has it, only admins can change its papers
    if (IN_APPROVAL.includes(settlement.workflowStatus) && !isAdminUser(req.user)) {
      removeUploadedFiles(files);
      return res.status(400).json({ message: 'Attachments are locked while the settlement is out for approval. Ask the approver to return it.' });
    }
    const added = files.map((f) => ({
      name: String(f.originalname || 'Attachment').trim().slice(0, 200) || 'Attachment',
      filePath: `/uploads/final-settlements/${f.filename}`,
      mimeType: f.mimetype,
      size: f.size,
      uploadedBy: req.user._id,
      uploadedAt: new Date()
    }));
    // Targeted update: totals and workflow fields are not recalculated by adding a paper
    await FinalSettlement.updateOne(
      { _id: settlement._id },
      { $push: { documents: { $each: added } }, $set: { updatedBy: req.user._id } }
    );
    const documents = await settlementDocuments(settlement._id);
    await syncSettlementDocumentsToBill({ documents, financeApBillId: settlement.financeApBillId });
    res.json({ message: `${files.length} attachment(s) added`, documents });
  } catch (error) {
    removeUploadedFiles(files);
    console.error('Error adding settlement attachments:', error);
    res.status(500).json({ message: 'Error adding attachments', error: error.message });
  }
});

// @route   DELETE /api/final-settlements/:id/documents/:docId
router.delete('/:id/documents/:docId', authMiddleware, checkPermission('settlement_management'), async (req, res) => {
  try {
    const settlement = await FinalSettlement.findById(req.params.id).select('documents status workflowStatus financeApBillId');
    if (!settlement) return res.status(404).json({ message: 'Settlement not found' });
    const doc = settlement.documents.id(req.params.docId);
    if (!doc) return res.status(404).json({ message: 'Attachment not found' });
    const locked = settlement.status !== 'pending' || IN_APPROVAL.includes(settlement.workflowStatus);
    if (locked && !isAdminUser(req.user)) {
      return res.status(400).json({ message: 'Attachments can only be removed while the settlement is with HR (not forwarded / approved)' });
    }
    const filePath = doc.filePath;
    await FinalSettlement.updateOne(
      { _id: settlement._id },
      { $pull: { documents: { _id: doc._id } }, $set: { updatedBy: req.user._id } }
    );
    if (filePath && filePath.startsWith('/uploads/final-settlements/')) {
      fs.unlink(path.join(settlementUploadDir, path.basename(filePath)), () => {});
    }
    const documents = await settlementDocuments(settlement._id);
    await syncSettlementDocumentsToBill({ documents, financeApBillId: settlement.financeApBillId });
    res.json({ message: 'Attachment removed', documents });
  } catch (error) {
    console.error('Error removing settlement attachment:', error);
    res.status(500).json({ message: 'Error removing attachment', error: error.message });
  }
});

router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const settlement = await FinalSettlement.findById(req.params.id)
      .populate({
        path: 'employee',
        select: 'employeeId firstName lastName guardianName idCard address hireDate appointmentDate confirmationDate employmentStatus salary allowances placementProject placementSection placementDepartment placementDesignation',
        populate: [
          { path: 'placementProject', select: 'name' },
          { path: 'placementSection', select: 'name' },
          { path: 'placementDepartment', select: 'name' },
          { path: 'placementDesignation', select: 'title' }
        ]
      })
      .populate('loans.loanId')
      .populate('documents.uploadedBy', 'firstName lastName')
      .populate(approverPopulate)
      .populate('approvedBy', 'name')
      .populate('processedBy', 'name')
      .populate('createdBy', 'name')
      .populate('updatedBy', 'name')
      .populate('comments.user', 'name');

    if (!settlement) {
      return res.status(404).json({
        success: false,
        message: 'Settlement not found'
      });
    }

    await syncFinalSettlementPayments([settlement]).catch((e) => console.error('Settlement payment sync failed:', e.message));
    // Add virtual fields
    const settlementData = settlement.toObject();
    settlementData.settlementProgress = settlement.settlementProgress;
    settlementData.noticePeriodShortfallDays = settlement.noticePeriodShortfallDays;
    settlementData.totalOutstandingLoans = settlement.totalOutstandingLoans;
    settlementData.myWorkflowRole = workflowRoleFor(settlementData, req.user);

    res.json({
      success: true,
      data: settlementData
    });
  } catch (error) {
    console.error('Error fetching settlement:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching settlement',
      error: error.message
    });
  }
});

// Create new settlement
router.post('/', authMiddleware, checkPermission('settlement_create'), async (req, res) => {
  try {
    const {
      employeeId,
      companyId: clientCompanyId,
      settlementType,
      reason,
      lastWorkingDate,
      settlementDate,
      noticePeriod,
      noticePeriodServed,
      noticePeriodShortfall: clientNoticeShortfall,
      paymentMethod,
      bankDetails,
      notes,
      basicSalary: clientBasicSalary,
      grossSalary: clientGrossSalary,
      netSalary: clientNetSalary,
      actualSalary: clientActualSalary,
      earnings: clientEarnings,
      deductions: clientDeductions,
      grossSettlementAmount: clientGrossSettlement,
      netSettlementAmount: clientNetSettlement,
      leaveBalance: clientLeaveBalance,
      loans: clientLoans,
      standardEarnings: clientStandardEarnings,
      monthSalaries: clientMonthSalaries
    } = req.body;

    let company;
    try {
      company = await resolveSettlementCompany(clientCompanyId);
    } catch (err) {
      return res.status(err.statusCode || 400).json({ success: false, message: err.message });
    }

    // Get employee details with populated department and position
    const employee = await Employee.findOne({ employeeId })
      .populate('department', 'name')
      .populate('position', 'title')
      .populate('placementDepartment', 'name')
      .populate('placementDesignation', 'title');
    if (!employee) {
      return res.status(404).json({
        success: false,
        message: 'Employee not found'
      });
    }

    // Get employee's active loans
    const activeLoans = await Loan.find({
      employee: employee._id,
      status: { $in: ['active', 'approved'] }
    });

    const noticePeriodShortfall = clientNoticeShortfall != null
      ? clientNoticeShortfall
      : Math.max(0, (noticePeriod || 0) - (noticePeriodServed || 0));

    // Basic in the settlement = the full monthly salary (gross); allowances are paid on top (Sidat "Final Dues")
    const grossSalary = clientGrossSalary ?? employee.salary?.gross ?? 0;
    const basicSalary = clientBasicSalary ?? grossSalary;
    const netSalary = clientNetSalary ?? employee.salary?.net ?? 0;

    const defaultEarnings = {
      basicSalary,
      houseRent: employee.salary?.houseRent || employee.allowances?.houseRent?.amount || 0,
      medicalAllowance: employee.salary?.medical || employee.allowances?.medical?.amount || 0,
      conveyanceAllowance: employee.allowances?.conveyance?.amount || employee.allowances?.transport?.amount || 0,
      foodAllowance: employee.allowances?.food?.amount || 0,
      mobileAllowance: employee.allowances?.mobile?.amount || 0,
      vehicleAllowance: employee.allowances?.vehicle?.amount || 0,
      fuelAllowance: employee.allowances?.fuel?.amount || 0,
      specialAllowance: employee.allowances?.special?.amount || 0,
      otherAllowances: employee.salary?.otherAllowances || employee.allowances?.other?.amount || 0,
      otherEarnings: 0,
      overtime: 0,
      bonus: 0,
      gratuity: 0,
      leaveEncashment: 0,
      noticePay: 0,
      providentFund: 0,
      eobi: 0
    };

    const defaultDeductions = {
      incomeTax: 0,
      providentFund: 0,
      eobi: 0,
      loanDeductions: 0,
      noticePeriodDeduction: 0,
      otherDeductions: 0
    };

    if (noticePeriodShortfall > 0 && !clientDeductions) {
      const rateDate = resolveSettlementRateDate({ lastWorkingDate, settlementDate });
      defaultDeductions.noticePeriodDeduction = getSettlementShortfallDeduction(
        grossSalary,
        noticePeriod,
        noticePeriodServed,
        rateDate
      );
    }

    const earnings = clientEarnings
      ? { ...defaultEarnings, ...clientEarnings }
      : defaultEarnings;
    if (earnings.transportAllowance != null && !(Number(earnings.conveyanceAllowance) > 0)) {
      earnings.conveyanceAllowance = earnings.transportAllowance;
    }
    delete earnings.transportAllowance;

    const deductions = clientDeductions
      ? { ...defaultDeductions, ...clientDeductions }
      : defaultDeductions;
    if (deductions.taxDeductions != null && !(Number(deductions.incomeTax) > 0)) {
      deductions.incomeTax = deductions.taxDeductions;
    }
    delete deductions.taxDeductions;

    const loans = Array.isArray(clientLoans) && clientLoans.length > 0
      ? clientLoans
      : activeLoans.map(loan => ({
        loanId: loan._id,
        loanType: loan.loanType,
        originalAmount: loan.loanAmount,
        outstandingBalance: loan.outstandingBalance,
        settledAmount: 0,
        settlementType: 'pending'
      }));

    const sumValues = (obj) => Object.values(obj).reduce((sum, val) => sum + (Number(val) || 0), 0);
    const grossSettlementAmount = clientGrossSettlement ?? sumValues(earnings);
    const netSettlementAmount = clientNetSettlement ?? (grossSettlementAmount - sumValues(deductions));

    const settlement = new FinalSettlement({
      employee: employee._id,
      employeeId: employee.employeeId,
      employeeName: `${employee.firstName} ${employee.lastName}`,
      department: employee.placementDepartment?.name || employee.department?.name || 'Unknown',
      designation: employee.placementDesignation?.title || employee.position?.title || 'Unknown',
      companyId: company.companyId,
      companyName: company.companyName,
      settlementType,
      reason,
      noticePeriod,
      noticePeriodServed,
      noticePeriodShortfall,
      lastWorkingDate,
      settlementDate,
      basicSalary,
      grossSalary,
      netSalary,
      actualSalary: clientActualSalary != null
        ? clientActualSalary
        : getSettlementActualSalary(grossSalary, noticePeriodServed, resolveSettlementRateDate({ lastWorkingDate, settlementDate })),
      earnings,
      deductions,
      loans,
      leaveBalance: clientLeaveBalance,
      standardEarnings: clientStandardEarnings,
      monthSalaries: cleanMonthSalaries(clientMonthSalaries),
      grossSettlementAmount,
      netSettlementAmount,
      paymentMethod,
      bankDetails,
      notes,
      createdBy: req.user._id
    });

    await settlement.save();

    res.status(201).json({
      success: true,
      message: 'Settlement created successfully',
      data: settlement
    });
  } catch (error) {
    console.error('Error creating settlement:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating settlement',
      error: error.message
    });
  }
});

// Update settlement
router.put('/:id', authMiddleware, checkPermission('settlement_management'), async (req, res) => {
  try {
    const settlement = await FinalSettlement.findById(req.params.id);
    if (!settlement) {
      return res.status(404).json({
        success: false,
        message: 'Settlement not found'
      });
    }

    // Only allow updates if status is pending
    if (settlement.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: 'Cannot update settlement that is not pending'
      });
    }
    // Locked while it is out for approval (admins may still correct it)
    if (IN_APPROVAL.includes(settlement.workflowStatus) && !isAdminUser(req.user)) {
      return res.status(400).json({
        success: false,
        message: `Cannot edit while the settlement is ${settlement.workflowStatus}. Ask the approver to return it.`
      });
    }
    // Never take workflow fields from the edit form (attachments have their own routes)
    ['documents', 'workflowStatus', ...APPROVER_FIELDS, 'hodApprovedAt', 'avpApprovedAt', 'ceoApprovedAt', 'forwardedAt', 'returnedAt',
      'financeApBillId', 'financeApBillNumber', 'financePostedAt', 'financePostedBy', 'financePostError', 'paidAt', 'companyName']
      .forEach((k) => { delete req.body[k]; });
    if (req.body.companyId !== undefined || !settlement.companyId) {
      try {
        Object.assign(req.body, await resolveSettlementCompany(req.body.companyId));
      } catch (err) {
        return res.status(err.statusCode || 400).json({ success: false, message: err.message });
      }
    }

    const body = { ...req.body };
    // Map form transportAllowance into schema conveyanceAllowance
    if (body.earnings) {
      if (body.earnings.transportAllowance != null && !(Number(body.earnings.conveyanceAllowance) > 0)) {
        body.earnings.conveyanceAllowance = body.earnings.transportAllowance;
      }
      delete body.earnings.transportAllowance;
    }
    if (body.deductions && body.deductions.taxDeductions != null && !(Number(body.deductions.incomeTax) > 0)) {
      body.deductions.incomeTax = body.deductions.taxDeductions;
      delete body.deductions.taxDeductions;
    }

    if (body.monthSalaries !== undefined) {
      body.monthSalaries = cleanMonthSalaries(body.monthSalaries);
    }

    Object.keys(body).forEach((key) => {
      if (key === 'updatedBy' || key === '_id' || key === 'createdBy' || key === 'createdAt') return;
      settlement[key] = body[key];
    });
    settlement.updatedBy = req.user._id;
    await settlement.save();

    res.json({
      success: true,
      message: 'Settlement updated successfully',
      data: settlement
    });
  } catch (error) {
    console.error('Error updating settlement:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating settlement',
      error: error.message
    });
  }
});

// Approve settlement
router.patch('/:id/approve', authMiddleware, checkPermission('settlement_approval'), async (req, res) => {
  try {
    const settlement = await FinalSettlement.findById(req.params.id);
    if (!settlement) {
      return res.status(404).json({
        success: false,
        message: 'Settlement not found'
      });
    }

    if (settlement.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: 'Settlement is not in pending status'
      });
    }
    // Approval goes through Forward → GM HR → AVP → CEO; direct approval is for admins only
    if (!isAdminUser(req.user)) {
      return res.status(400).json({
        success: false,
        message: 'Forward the settlement for approval (GM HR → AVP → CEO).'
      });
    }

    settlement.status = 'approved';
    settlement.workflowStatus = 'Approved by CEO';
    settlement.approvalDate = new Date();
    settlement.approvedBy = req.user._id;
    settlement.updatedBy = req.user._id;

    await settlement.save();
    const fin = await postFinalSettlementToFinance(settlement, req.user);

    res.json({
      success: true,
      message: fin.posted
        ? `Settlement approved and sent to Finance (bill ${fin.billNumber})`
        : `Settlement approved — could not send to Finance: ${fin.error}`,
      data: settlement
    });
  } catch (error) {
    console.error('Error approving settlement:', error);
    res.status(500).json({
      success: false,
      message: 'Error approving settlement',
      error: error.message
    });
  }
});

// Process settlement
router.patch('/:id/process', authMiddleware, checkPermission('settlement_processing'), async (req, res) => {
  try {
    const settlement = await FinalSettlement.findById(req.params.id);
    if (!settlement) {
      return res.status(404).json({
        success: false,
        message: 'Settlement not found'
      });
    }

    if (settlement.status !== 'approved') {
      return res.status(400).json({
        success: false,
        message: 'Settlement must be approved before processing'
      });
    }
    if (settlement.financeApBillId) {
      return res.status(400).json({
        success: false,
        message: `This settlement is paid by Finance (bill ${settlement.financeApBillNumber || ''}) — it is marked Paid automatically`
      });
    }

    // Process loan settlements
    settlement.processLoanSettlements();

    settlement.status = 'processed';
    settlement.processedDate = new Date();
    settlement.processedBy = req.user._id;
    settlement.updatedBy = req.user._id;

    await settlement.save();

    res.json({
      success: true,
      message: 'Settlement processed successfully',
      data: settlement
    });
  } catch (error) {
    console.error('Error processing settlement:', error);
    res.status(500).json({
      success: false,
      message: 'Error processing settlement',
      error: error.message
    });
  }
});

// Mark as paid
router.patch('/:id/paid', authMiddleware, checkPermission('settlement_processing'), async (req, res) => {
  try {
    const settlement = await FinalSettlement.findById(req.params.id);
    if (!settlement) {
      return res.status(404).json({
        success: false,
        message: 'Settlement not found'
      });
    }

    if (settlement.status !== 'processed') {
      return res.status(400).json({
        success: false,
        message: 'Settlement must be processed before marking as paid'
      });
    }
    if (settlement.financeApBillId) {
      return res.status(400).json({
        success: false,
        message: `This settlement is paid by Finance (bill ${settlement.financeApBillNumber || ''}) — it is marked Paid automatically`
      });
    }

    settlement.status = 'paid';
    settlement.updatedBy = req.user._id;

    await settlement.save();

    res.json({
      success: true,
      message: 'Settlement marked as paid successfully',
      data: settlement
    });
  } catch (error) {
    console.error('Error marking settlement as paid:', error);
    res.status(500).json({
      success: false,
      message: 'Error marking settlement as paid',
      error: error.message
    });
  }
});

// Cancel settlement
router.patch('/:id/cancel', authMiddleware, checkPermission('settlement_management'), async (req, res) => {
  try {
    const settlement = await FinalSettlement.findById(req.params.id);
    if (!settlement) {
      return res.status(404).json({
        success: false,
        message: 'Settlement not found'
      });
    }

    if (settlement.status === 'paid') {
      return res.status(400).json({
        success: false,
        message: 'Cannot cancel a paid settlement'
      });
    }
    if (settlement.financeApBillId) {
      return res.status(400).json({
        success: false,
        message: `Finance bill ${settlement.financeApBillNumber || ''} is open for this settlement — ask Finance to void it first`
      });
    }

    settlement.status = 'cancelled';
    settlement.updatedBy = req.user._id;

    await settlement.save();

    res.json({
      success: true,
      message: 'Settlement cancelled successfully',
      data: settlement
    });
  } catch (error) {
    console.error('Error cancelling settlement:', error);
    res.status(500).json({
      success: false,
      message: 'Error cancelling settlement',
      error: error.message
    });
  }
});

// Add comment to settlement
router.post('/:id/comments', authMiddleware, async (req, res) => {
  try {
    const { comment } = req.body;
    
    const settlement = await FinalSettlement.findById(req.params.id);
    if (!settlement) {
      return res.status(404).json({
        success: false,
        message: 'Settlement not found'
      });
    }

    settlement.comments.push({
      user: req.user._id,
      comment
    });

    await settlement.save();

    res.json({
      success: true,
      message: 'Comment added successfully',
      data: settlement.comments[settlement.comments.length - 1]
    });
  } catch (error) {
    console.error('Error adding comment:', error);
    res.status(500).json({
      success: false,
      message: 'Error adding comment',
      error: error.message
    });
  }
});

// Delete settlement (only if pending)
router.delete('/:id', authMiddleware, checkPermission('settlement_management'), async (req, res) => {
  try {
    const settlement = await FinalSettlement.findById(req.params.id);
    if (!settlement) {
      return res.status(404).json({
        success: false,
        message: 'Settlement not found'
      });
    }

    if (settlement.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete settlement that is not pending'
      });
    }

    await FinalSettlement.findByIdAndDelete(req.params.id);

    res.json({
      success: true,
      message: 'Settlement deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting settlement:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting settlement',
      error: error.message
    });
  }
});

module.exports = router; 