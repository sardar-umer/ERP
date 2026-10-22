const express = require('express');
const mongoose = require('mongoose');
const { body, validationResult } = require('express-validator');
const { asyncHandler } = require('../middleware/errorHandler');
const { authorize } = require('../middleware/auth');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Import models
const Account = require('../models/finance/Account');
const JournalEntry = require('../models/finance/JournalEntry');
const GeneralLedger = require('../models/finance/GeneralLedger');
const AccountsReceivable = require('../models/finance/AccountsReceivable');
const AccountsPayable = require('../models/finance/AccountsPayable');
const Banking = require('../models/finance/Banking');
const RecurringJournal = require('../models/finance/RecurringJournal');
const FinanceHelper = require('../utils/financeHelper');
const VendorAdvance = require('../models/finance/VendorAdvance');
const Supplier = require('../models/hr/Supplier');
const PurchaseOrder = require('../models/procurement/PurchaseOrder');
const {
  getRequiredFinanceAuthoritySlots,
  matchUserToFinanceSlots
} = require('../utils/financeAuthoritySlots');
const {
  resolveEmployeeForFinanceQuery,
  buildCashApprovalEmployeeFilter
} = require('../utils/employeeAdvanceAccount');
const {
  listFinancePayrollQueue,
  getFinancePayrollPeriodDetail,
  getFinancePayrollBankLetter,
  markFinancePayrollPeriodPaid
} = require('../utils/financePayrollQueue');
const {
  listManualSalaryFinanceQueue,
  getManualSalaryFinancePeriodDetail,
  saveManualSalaryPaymentDraft,
  submitManualSalaryPaymentDraft,
  deleteManualSalaryPaymentDraft,
  submitManualSalaryPayment,
  populateManualSalaryPaymentApp,
  recordManualSalaryAuthorityApproval,
  recordManualSalaryAuthorityRejection
} = require('../utils/manualSalaryFinancePayment');
const PayrollPeriodPaymentHelper = require('../utils/payrollPeriodPayment');
const PayrollBankLetterService = require('../utils/payrollBankLetterService');
const { requireCompanyFromRequest, findHistoricalCompany, resolveCompanyForFinanceRoute, companyQuery, voucherCompanyQuery, resolveDocumentCompanyId, isHistoricalCompany } = require('../utils/financeCompanyContext');
const { financeScope, assertDocCompany, loadScopedDoc } = require('../utils/financeRouteScope');
const { co, acct, withCompany } = require('../utils/financePosting');
const { seedChartOfAccountsForCompany } = require('../utils/companyChartOfAccounts');
const GoodsReceive = require('../models/procurement/GoodsReceive');
const CashApproval = require('../models/procurement/CashApproval');
const Employee = require('../models/hr/Employee');
const UtilityBill = require('../models/hr/UtilityBill');
const BankingSetup = require('../models/finance/BankingSetup');
const { buildVendorBillFullWorkflowHistory } = require('../utils/vendorBillWorkflowHistory');

const escapeRegex = (s) => String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const cashApprovalFinanceAuthoritiesComplete = (ca) => {
  if (!ca) return false;
  const slots = getRequiredFinanceAuthoritySlots(ca);
  if (!slots.length) return false;
  const approvedKeys = new Set(
    (Array.isArray(ca.financeAuthorityApprovals) ? ca.financeAuthorityApprovals : [])
      .filter((a) => String(a?.decision || 'approved').trim() !== 'rejected')
      .map((a) => String(a?.authorityKey || '').trim())
      .filter(Boolean)
  );
  return slots.every((s) => approvedKeys.has(s.key));
};

const attachCashApprovalWorkflowFlags = async (entries) => {
  const docs = entries.map((e) => (e.toObject ? e.toObject() : { ...e }));
  const paymentRows = docs.filter((e) => e.referenceType === 'payment');
  if (!paymentRows.length) return docs;

  const entryIds = paymentRows.map((e) => e._id);
  const refIds = paymentRows.map((e) => e.referenceId).filter(Boolean);
  const linkedCas = await CashApproval.find({
    $or: [{ _id: { $in: refIds } }, { voucherEntryId: { $in: entryIds } }]
  })
    .select('financeApprovalAuthorities financeAuthorityApprovals voucherEntryId')
    .lean();

  const caByRef = new Map(linkedCas.map((ca) => [String(ca._id), ca]));
  const caByVoucher = new Map(
    linkedCas.filter((ca) => ca.voucherEntryId).map((ca) => [String(ca.voucherEntryId), ca])
  );

  return docs.map((e) => {
    if (e.referenceType !== 'payment') return e;
    const ca = caByRef.get(String(e.referenceId)) || caByVoucher.get(String(e._id));
    if (!ca) return e;
    return {
      ...e,
      cashApprovalAuthoritiesComplete: cashApprovalFinanceAuthoritiesComplete(ca)
    };
  });
};

const attachBillPaymentDetails = async (entries) => {
  const docs = entries.map((e) => (e.toObject ? e.toObject() : { ...e }));
  if (!docs.length) return docs;

  const entryIds = docs.map((e) => e._id);
  const refIds = docs.map((e) => e.referenceId).filter(Boolean);

  const formatEmployeeName = (emp) => {
    if (!emp) return '';
    const name = `${emp.firstName || ''} ${emp.lastName || ''}`.trim();
    if (name && emp.employeeId) return `${name} (${emp.employeeId})`;
    return name || emp.employeeId || '';
  };

  const partyFromBill = (bill) => {
    if (!bill) return '';
    // AP stores vendor as embedded { name, vendorId }; employee as payeeEmployee ref
    return (
      bill.vendor?.name ||
      bill.vendorName ||
      formatEmployeeName(bill.payeeEmployee) ||
      ''
    );
  };

  // 1. Match AccountsPayable (bills) — vendor.name is embedded; populate employee payee
  const matchedBills = await AccountsPayable.find({
    $or: [
      { _id: { $in: refIds } },
      { voucherEntryId: { $in: entryIds } },
      { journalEntryId: { $in: entryIds } }
    ]
  })
    .select('_id status totalAmount amountPaid paidAmount advanceApplied advancePending paymentPending balanceDue billNumber vendor vendorName payeeEmployee voucherEntryId journalEntryId')
    .populate('payeeEmployee', 'firstName lastName employeeId')
    .lean();

  const billByRef = new Map(matchedBills.map((b) => [String(b._id), b]));
  const billByVoucher = new Map();
  matchedBills.forEach((b) => {
    if (b.voucherEntryId) billByVoucher.set(String(b.voucherEntryId), b);
    if (b.journalEntryId) billByVoucher.set(String(b.journalEntryId), b);
  });

  // 2. Match VendorAdvance (vendor.name is embedded string on the doc)
  const matchedVendorAdvances = await VendorAdvance.find({
    $or: [
      { _id: { $in: refIds } },
      { journalEntryId: { $in: entryIds } },
      { payingJournalEntryId: { $in: entryIds } }
    ]
  })
    .select('_id vendor chequeNumber journalEntryId payingJournalEntryId')
    .lean();

  const vaByRef = new Map(matchedVendorAdvances.map((v) => [String(v._id), v]));
  const vaByJe = new Map();
  matchedVendorAdvances.forEach((v) => {
    if (v.journalEntryId) vaByJe.set(String(v.journalEntryId), v);
    if (v.payingJournalEntryId) vaByJe.set(String(v.payingJournalEntryId), v);
  });

  // 3. Match CashApproval — party from advanceToName, vendor, or advanceToEmployee
  const matchedCashApprovals = await CashApproval.find({
    $or: [
      { _id: { $in: refIds } },
      { voucherEntryId: { $in: entryIds } }
    ]
  })
    .select('_id advanceToName caNumber vendor voucherEntryId advanceToEmployee')
    .populate('vendor', 'name')
    .populate('advanceToEmployee', 'firstName lastName employeeId')
    .lean();

  const caByRef = new Map(matchedCashApprovals.map((c) => [String(c._id), c]));
  const caByVoucher = new Map(matchedCashApprovals.filter(c => c.voucherEntryId).map((c) => [String(c.voucherEntryId), c]));

  // 4. Match ApPaymentApplication (batch or single bill payments)
  const ApPaymentApplication = require('../models/finance/ApPaymentApplication');
  const matchedApApps = await ApPaymentApplication.find({
    $or: [
      { journalEntryId: { $in: entryIds } },
      { payingJournalEntryId: { $in: entryIds } }
    ]
  })
    .populate({
      path: 'accountsPayableId',
      select: 'vendor vendorName payeeEmployee',
      populate: [{ path: 'payeeEmployee', select: 'firstName lastName employeeId' }]
    })
    .populate({
      path: 'bills.billId',
      select: 'vendor vendorName payeeEmployee',
      populate: [{ path: 'payeeEmployee', select: 'firstName lastName employeeId' }]
    })
    .lean();
  const apAppByJe = new Map();
  matchedApApps.forEach((a) => {
    if (a.journalEntryId) apAppByJe.set(String(a.journalEntryId), a);
    if (a.payingJournalEntryId) apAppByJe.set(String(a.payingJournalEntryId), a);
  });

  return docs.map((e) => {
    const bill = billByRef.get(String(e.referenceId)) || billByVoucher.get(String(e._id));
    const va = vaByRef.get(String(e.referenceId)) || vaByJe.get(String(e._id));
    const ca = caByRef.get(String(e.referenceId)) || caByVoucher.get(String(e._id));
    const apApp = apAppByJe.get(String(e._id));

    let vendorOrEmpName =
      partyFromBill(bill) ||
      va?.vendor?.name ||
      ca?.advanceToName ||
      ca?.vendor?.name ||
      formatEmployeeName(ca?.advanceToEmployee) ||
      '';

    if (!vendorOrEmpName && apApp) {
      const fromHeader = partyFromBill(apApp.accountsPayableId);
      if (fromHeader) {
        vendorOrEmpName = fromHeader;
      } else if (apApp.bills?.length > 0) {
        const names = Array.from(
          new Set(apApp.bills.map((b) => partyFromBill(b.billId)).filter(Boolean))
        );
        if (names.length > 0) vendorOrEmpName = names.join(', ');
      }
    }

    if (e.referenceType !== 'bill') {
      return {
        ...e,
        reference: va?.chequeNumber || e.reference,
        vendorOrEmployeeName: vendorOrEmpName || e.vendorOrEmployeeName
      };
    }

    if (!bill) {
      return {
        ...e,
        vendorOrEmployeeName: vendorOrEmpName || e.vendorOrEmployeeName
      };
    }

    const total = Number(bill.totalAmount || 0);
    const paid = Number(bill.paidAmount ?? bill.amountPaid ?? 0);
    const advance = Number(bill.advanceApplied || 0);
    const settled = Math.round((paid + advance) * 100) / 100;
    const balance = Math.round(Math.max(0, total - settled) * 100) / 100;

    let paymentStatus = 'unpaid';
    if (bill.status === 'cancelled' || e.status === 'cancelled' || e.status === 'reversed') {
      paymentStatus = 'cancelled';
    } else if (bill.status === 'paid' || (total > 0 && settled >= total - 0.01)) {
      paymentStatus = 'paid';
    } else if (settled > 0 || bill.status === 'partial') {
      paymentStatus = 'partial';
    } else {
      paymentStatus = 'unpaid';
    }

    return {
      ...e,
      billId: bill._id,
      billNumber: bill.billNumber,
      billStatus: bill.status,
      billTotalAmount: total,
      billSettledAmount: settled,
      billBalanceDue: balance,
      vendorOrEmployeeName: partyFromBill(bill) || vendorOrEmpName,
      billPaymentStatus: paymentStatus
    };
  });
};
const {
  isFullAdvancePaymentTerm,
  buildJournalEntrySignedMapForVendorAdvances,
  vendorAdvanceAmountCountsForPo,
  sumPostedVendorAdvancesForPo,
  vendorAdvancesLinkedToPurchaseOrderFilter
} = require('../utils/fullAdvancePoGate');
const { notifyApprovers } = require('../utils/approvalWhatsAppNotifier');
const { notifyChatApprovers } = require('../utils/approvalChatNotifier');

const router = express.Router();

// Lock for auto-seeding to prevent duplicate key errors during concurrent requests
const activeAccountSeedings = new Map();
const { ACCOUNT_TYPES_GROUPED, ACCOUNT_TYPE_TO_SECTION, DETAIL_TYPES_BY_ACCOUNT_TYPE } = require('../config/accountDetailTypes');

async function tryAutoApprovePoAfterVendorAdvance(advance, userId) {
  if (!advance.referenceId) return;
  const po = await PurchaseOrder.findById(advance.referenceId);
  if (!po || po.status !== 'Pending Finance' || !isFullAdvancePaymentTerm(po.paymentTerms)) return;
  const poTotal = Math.round((Number(po.totalAmount) || 0) * 100) / 100;
  if (poTotal <= 0) return;
  const paid = await sumPostedVendorAdvancesForPo(po._id);
  if (paid + 0.009 < poTotal) return;
  po.workflowHistory = po.workflowHistory || [];
  po.workflowHistory.push({
    fromStatus: 'Pending Finance',
    toStatus: 'Approved',
    changedBy: userId,
    changedAt: new Date(),
    comments: 'Auto-approved by Finance after vendor advance voucher signed document was marked signed (full advance)',
    department: 'Finance'
  });
  po.status = 'Approved';
  po.financeApprovedBy = userId;
  po.financeApprovedAt = new Date();
  po.financeRemarks = 'Auto-approved after full vendor advance and voucher signed document';
  po.updatedBy = userId;
  await po.save();
}

async function populateVendorAdvanceDoc(query) {
  return VendorAdvance.findOne(query)
    .populate('bankAccountId', 'name accountNumber type category companyId')
    .populate('companyId', 'name companyCode')
    .populate('payingCompanyId', 'name companyCode')
    .populate('journalEntryId', 'entryNumber voucherSeries companyId status')
    .populate('payingJournalEntryId', 'entryNumber voucherSeries companyId status')
    .populate('financeApprovalAuthorities.accountsOfficerUser', 'firstName lastName email employeeId digitalSignature')
    .populate('financeApprovalAuthorities.accountsManagerUser', 'firstName lastName email employeeId digitalSignature')
    .populate('financeApprovalAuthorities.financeControllerUser', 'firstName lastName email employeeId digitalSignature')
    .populate('financeAuthorityApprovals.approver', 'firstName lastName email employeeId digitalSignature');
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(__dirname, '..', 'uploads', 'finance');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  }
});

const User = require('../models/User');

// @route   GET /api/finance/finance-authority-candidates
// @desc    Active users for AP settlement / vendor advance finance authority pickers
// @access  Private (Finance and Admin)
router.get('/finance-authority-candidates',
  authorize('super_admin', 'admin', 'finance_manager'),
  asyncHandler(async (req, res) => {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 150, 1), 200);
    const search = String(req.query.search || '').trim();
    const escapeRx = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    const andClauses = [
      { isActive: true },
      {
        $or: [
          { department: { $regex: /finance|account/i } },
          { role: { $in: ['finance_manager', 'admin', 'super_admin'] } }
        ]
      }
    ];
    if (search) {
      const rx = new RegExp(escapeRx(search), 'i');
      andClauses.push({
        $or: [
          { firstName: rx },
          { lastName: rx },
          { email: rx },
          { employeeId: rx },
          { department: rx }
        ]
      });
    }

    let users = await User.find({ $and: andClauses })
      .select('firstName lastName email employeeId department position role digitalSignature')
      .sort({ firstName: 1, lastName: 1 })
      .limit(limit)
      .lean();

    if (users.length < 3) {
      const broadClauses = [{ isActive: true }];
      if (search) {
        const rx = new RegExp(escapeRx(search), 'i');
        broadClauses.push({
          $or: [
            { firstName: rx },
            { lastName: rx },
            { email: rx },
            { employeeId: rx },
            { department: rx }
          ]
        });
      }
      users = await User.find(broadClauses.length > 1 ? { $and: broadClauses } : broadClauses[0])
        .select('firstName lastName email employeeId department role digitalSignature')
        .sort({ firstName: 1, lastName: 1 })
        .limit(limit)
        .lean();
    }

    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.json({ success: true, data: users });
  })
);

// ================================
// CHART OF ACCOUNTS ROUTES
// ================================

// @route   GET /api/finance/accounts/detail-types
// @desc    Get account types and detail types (QuickBooks-style)
// @access  Private
router.get('/accounts/detail-types',
  authorize('super_admin', 'admin', 'finance_manager'),
  asyncHandler(async (req, res) => {
    res.json({
      success: true,
      data: {
        accountTypesGrouped: ACCOUNT_TYPES_GROUPED,
        detailTypesByAccountType: DETAIL_TYPES_BY_ACCOUNT_TYPE
      }
    });
  })
);

// @route   GET /api/finance/accounts
// @desc    Get all accounts with filtering and pagination
// @access  Private (Finance and Admin)
// procurement_manager: read-only list for inventory item GL linking (same CoA as finance; no write access on other routes)
router.get('/accounts', 
  authorize('super_admin', 'admin', 'finance_manager', 'procurement_manager'), 
  asyncHandler(async (req, res) => {
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    const { 
      page = 1, 
      limit = 20, 
      type, 
      category,
      department,
      module,
      search,
      allCompanies
    } = req.query;

    const baseQuery = { isActive: true };

    // Add filters
    if (type) baseQuery.type = type;
    if (category) baseQuery.category = category;
    if (department) baseQuery.department = department;
    if (module) baseQuery.module = module;
    if (search) {
      baseQuery.$or = [
        { name: { $regex: search, $options: 'i' } },
        { accountNumber: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { accountCode: { $regex: search, $options: 'i' } }
      ];
    }

    let query;
    let company = null;
    if (allCompanies === 'true' || req.query.companyId === 'all') {
      query = baseQuery;
    } else {
      try {
        company = await requireCompanyFromRequest(req);
      } catch (err) {
        company = await findHistoricalCompany();
        if (!company) throw err;
      }
      query = companyQuery(baseQuery, company);
    }

    // Auto-seed system accounts if the company has zero accounts seeded
    const companyQueryObj = companyQuery({ isActive: true }, company);
    const hasAccounts = await Account.exists(companyQueryObj);
    if (!hasAccounts && company && company._id) {
      const lockKey = String(company._id);
      if (!activeAccountSeedings.has(lockKey)) {
        const seedPromise = seedChartOfAccountsForCompany(company._id, {
          createdBy: req.user?._id || req.user?.id,
          skipExisting: true
        }).catch(err => {
          if (err.code !== 11000) console.error('Auto-seed error:', err);
        }).finally(() => {
          activeAccountSeedings.delete(lockKey);
        });
        activeAccountSeedings.set(lockKey, seedPromise);
      }
      await activeAccountSeedings.get(lockKey);
    }

    const accounts = await Account.find(query)
      .populate('parentAccount', 'accountNumber name')
      .populate('companyId', 'name companyCode')
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .sort({ accountNumber: 1 });

    const total = await Account.countDocuments(query);

    res.json({
      success: true,
      data: {
        company,
        accounts,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / limit),
          totalCount: total,
          hasNextPage: page < Math.ceil(total / limit),
          hasPrevPage: page > 1,
          limit: parseInt(limit)
        }
      }
    });
  })
);

// @route   GET /api/finance/accounts/hierarchy
// @desc    Get accounts in hierarchical structure
// @access  Private (Finance and Admin)
router.get('/accounts/hierarchy', 
  authorize('super_admin', 'admin', 'finance_manager'), 
  asyncHandler(async (req, res) => {
    const company = await requireCompanyFromRequest(req);

    // Auto-seed system accounts if the company has zero accounts seeded
    const companyQueryObj = companyQuery({ isActive: true }, company);
    const hasAccounts = await Account.exists(companyQueryObj);
    if (!hasAccounts && company && company._id) {
      const lockKey = String(company._id);
      if (!activeAccountSeedings.has(lockKey)) {
        const seedPromise = seedChartOfAccountsForCompany(company._id, {
          createdBy: req.user?._id || req.user?.id,
          skipExisting: true
        }).catch(err => {
          if (err.code !== 11000) console.error('Auto-seed error:', err);
        }).finally(() => {
          activeAccountSeedings.delete(lockKey);
        });
        activeAccountSeedings.set(lockKey, seedPromise);
      }
      await activeAccountSeedings.get(lockKey);
    }

    const hierarchy = await Account.getHierarchy(company._id);
    res.json({
      success: true,
      data: { company, hierarchy }
    });
  })
);

// @route   GET /api/finance/accounts/trial-balance
// @desc    Get trial balance
// @access  Private (Finance and Admin)
router.get('/accounts/trial-balance', 
  authorize('super_admin', 'admin', 'finance_manager'), 
  asyncHandler(async (req, res) => {
    const company = await requireCompanyFromRequest(req);

    // Auto-seed system accounts if the company has zero accounts seeded
    const companyQueryObj = companyQuery({ isActive: true }, company);
    const hasAccounts = await Account.exists(companyQueryObj);
    if (!hasAccounts && company && company._id) {
      const lockKey = String(company._id);
      if (!activeAccountSeedings.has(lockKey)) {
        const seedPromise = seedChartOfAccountsForCompany(company._id, {
          createdBy: req.user?._id || req.user?.id,
          skipExisting: true
        }).catch(err => {
          if (err.code !== 11000) console.error('Auto-seed error:', err);
        }).finally(() => {
          activeAccountSeedings.delete(lockKey);
        });
        activeAccountSeedings.set(lockKey, seedPromise);
      }
      await activeAccountSeedings.get(lockKey);
    }

    const trialBalance = await Account.getTrialBalance(company._id);
    res.json({
      success: true,
      data: { company, trialBalance }
    });
  })
);

// @route   POST /api/finance/accounts/ensure-defaults
// @desc    Upsert critical system accounts (WHT Payable, Retained Earnings, etc.) that must exist for GL posting
// @access  Private (Finance and Admin)
router.post('/accounts/ensure-defaults',
  authorize('super_admin', 'admin', 'finance_manager'),
  asyncHandler(async (req, res) => {
    const company = await requireCompanyFromRequest(req);
    const result = await seedChartOfAccountsForCompany(company._id, {
      createdBy: req.user._id || req.user.id,
      skipExisting: true
    });

    res.json({
      success: true,
      message: result.created > 0
        ? `${result.created} system account(s) created for ${company.name}, ${result.existing} already existed`
        : `All system accounts already exist for ${company.name}`,
      data: { company, ...result }
    });
  })
);

// @route   POST /api/finance/accounts
// @desc    Create new account
// @access  Private (Finance and Admin)
router.post('/accounts',
  authorize('super_admin', 'admin', 'finance_manager'),
  [
    body('accountNumber').trim().notEmpty().withMessage('Account number is required'),
    body('name').trim().notEmpty().withMessage('Account name is required'),
    body('accountType').notEmpty().withMessage('Account type is required'),
    body('detailType').notEmpty().withMessage('Detail type is required')
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      console.error("Journal Entry Validation Error (PUT):", JSON.stringify(errors.array(), null, 2));
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array(),
        errors: errors.array()
      });
    }

    const accountType = req.body.accountType || req.body.category; // e.g. "Cash and cash equivalents"
    const section = require('../config/accountDetailTypes').getSectionForAccountType(accountType) || 'Asset';
    const type = section === 'Income' ? 'Revenue' : section;
    const company = await requireCompanyFromRequest(req);
    const { accountType: _, ...rest } = req.body;
    let accountNumber;
    try {
      accountNumber = await Account.resolveAccountNumber(req.body.accountNumber, type, company._id);
    } catch (err) {
      return res.status(400).json({
        success: false,
        message: err.message || 'Could not assign an account number'
      });
    }
    const accountData = {
      ...rest,
      companyId: company._id,
      accountNumber,
      type,
      category: accountType,
      metadata: {
        createdBy: req.user._id
      }
    };

    const account = new Account(accountData);
    try {
      await account.save();
    } catch (err) {
      if (err?.code === 11000) {
        account.accountNumber = await Account.resolveAccountNumber(null, type, company._id);
        await account.save();
      } else {
        throw err;
      }
    }

    res.status(201).json({
      success: true,
      message: 'Account created successfully',
      data: account
    });
  })
);

// @route   PUT /api/finance/accounts/:id
// @desc    Update account
// @access  Private (Finance and Admin)
router.put('/accounts/:id',
  authorize('super_admin', 'admin', 'finance_manager'),
  [
    body('name').optional().trim().notEmpty().withMessage('Account name cannot be empty')
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      console.error("Journal Entry Validation Error (PUT):", JSON.stringify(errors.array(), null, 2));
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array(),
        errors: errors.array()
      });
    }

    const account = await Account.findById(req.params.id);
    if (!account) {
      return res.status(404).json({ success: false, message: 'Account not found' });
    }

    const {
      name,
      accountNumber,
      accountType,
      category,
      detailType,
      type,
      description,
      parentAccount,
      isSubaccount,
      isSubAccount,
      currency,
      isActive,
      notes
    } = req.body;

    if (name !== undefined) account.name = name.trim();
    if (accountNumber !== undefined && String(accountNumber).trim() !== account.accountNumber) {
      const existing = await Account.findOne({
        _id: { $ne: account._id },
        companyId: account.companyId,
        accountNumber: String(accountNumber).trim()
      });
      if (existing) {
        return res.status(400).json({
          success: false,
          message: `Account number "${String(accountNumber).trim()}" already exists for this company`
        });
      }
      account.accountNumber = String(accountNumber).trim();
    }
    if (category || accountType) {
      const cat = category || accountType;
      account.category = cat;
      const section = require('../config/accountDetailTypes').getSectionForAccountType(cat);
      if (section) {
        account.type = section === 'Income' ? 'Revenue' : section;
      }
    }
    if (type !== undefined) account.type = type;
    if (detailType !== undefined) account.detailType = detailType;
    if (description !== undefined) account.description = description;
    if (parentAccount !== undefined) account.parentAccount = parentAccount || null;
    if (isSubaccount !== undefined || isSubAccount !== undefined) {
      account.isSubAccount = Boolean(isSubaccount ?? isSubAccount);
    }
    if (currency !== undefined) account.currency = currency;
    if (isActive !== undefined) account.isActive = Boolean(isActive);
    if (notes !== undefined) account.notes = notes;

    await account.save();

    res.json({
      success: true,
      message: 'Account updated successfully',
      data: account
    });
  })
);

// @route   DELETE /api/finance/accounts/:id
// @desc    Deactivate (remove) a chart of accounts entry
// @access  Private (Finance and Admin)
router.delete('/accounts/:id',
  authorize('super_admin', 'admin', 'finance_manager'),
  asyncHandler(async (req, res) => {
    const account = await Account.findById(req.params.id);
    if (!account) {
      return res.status(404).json({ success: false, message: 'Account not found' });
    }

    if (account.isSystem || account.isSystemAccount) {
      return res.status(400).json({
        success: false,
        message: 'System accounts cannot be deleted'
      });
    }

    const childCount = await Account.countDocuments({
      parentAccount: account._id,
      isActive: true
    });
    if (childCount > 0) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete this account because it has ${childCount} active subaccount(s). Delete or reassign the subaccounts first.`
      });
    }

    const balance = Number(account.balance) || 0;
    if (Math.abs(balance) > 0.01) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete an account with a non-zero balance (${balance}). Clear or reclassify the balance first.`
      });
    }

    const usedInJournal = await JournalEntry.exists({ 'lines.account': account._id });
    if (usedInJournal) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete this account because it is used in journal entries'
      });
    }

    account.isActive = false;
    await account.save();

    res.json({
      success: true,
      message: 'Account deleted successfully',
      data: { account }
    });
  })
);

// ================================
// JOURNAL ENTRIES ROUTES
// ================================

// @route   GET /api/finance/journal-entries
// @desc    Get all journal entries with filtering
// @access  Private (Finance and Admin)
router.get('/journal-entries', 
  authorize('super_admin', 'admin', 'finance_manager'), 
  asyncHandler(async (req, res) => {
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    const { 
      page = 1, 
      limit = 20, 
      department,
      module,
      status,
      startDate,
      endDate,
      search,
      referenceType,
      excludeReferenceTypes
    } = req.query;

    const company = await resolveCompanyForFinanceRoute(req);
    const baseFilters = {};

    const allowedReferenceTypes = new Set([
      'payroll', 'invoice', 'bill', 'payment', 'receipt', 'adjustment', 'manual',
      'grn', 'sin', 'purchase_order', 'stock_adjustment', 'purchase_return',
      'depreciation', 'expense'
    ]);
    const excludedTypes = String(excludeReferenceTypes || '')
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter((value) => allowedReferenceTypes.has(value));

    if (referenceType && allowedReferenceTypes.has(String(referenceType).toLowerCase())) {
      baseFilters.referenceType = String(referenceType).toLowerCase();
    } else if (excludedTypes.length) {
      baseFilters.referenceType = { $nin: excludedTypes };
    }

    if (department) baseFilters.department = department;
    if (module) baseFilters.module = module;
    // Treat blank / "all" as no status filter (literal status:"all" matches nothing)
    const statusFilter = String(status || '').trim().toLowerCase();
    if (statusFilter === 'signed') {
      baseFilters.signedDocumentStatus = 'signed';
      baseFilters.signedDocumentAt = { $exists: true, $ne: null };
    } else if (statusFilter && statusFilter !== 'all') {
      baseFilters.status = statusFilter;
    }
    if (search) {
      baseFilters.$or = [
        { entryNumber: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { reference: { $regex: search, $options: 'i' } }
      ];
    }
    if (startDate || endDate) {
      baseFilters.date = {};
      if (startDate) {
        const start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
        baseFilters.date.$gte = start;
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        baseFilters.date.$lte = end;
      }
    }

    const filters = voucherCompanyQuery(baseFilters, company);
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Ensure populate refs are registered (hr routes usually load these first)
    require('../models/hr/Project');
    require('../models/hr/Department');
    
    const [entries, totalCount] = await Promise.all([
      JournalEntry.find(filters)
        .populate('companyId', 'name companyCode')
        .populate('lines.account', 'accountNumber name type')
        .populate('createdBy', 'firstName lastName')
        .populate('approvedBy', 'firstName lastName')
        .populate('project', 'name code')
        .sort({ date: -1, entryNumber: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      JournalEntry.countDocuments(filters)
    ]);

    const totalPages = Math.ceil(totalCount / parseInt(limit));

    let finalEntries;
    try {
    const entriesWithCaFlags = await attachCashApprovalWorkflowFlags(entries);
      const enrichedEntries = await attachBillPaymentDetails(entriesWithCaFlags);

      finalEntries = enrichedEntries.map(e => {
        let vName = e.vendorOrEmployeeName || '';
        if (!vName && e.description) {
          const desc = String(e.description);
          if (desc.startsWith('Batch Payment – ')) {
            vName = desc.replace('Batch Payment – ', '').split(' (pending')[0].split(' (Intercompany')[0];
          } else if (desc.startsWith('Vendor Advance: ')) {
            vName = desc.replace('Vendor Advance: ', '').split(' (pending')[0].split(' (Intercompany')[0];
          } else if (desc.startsWith('Advance payment to ')) {
            vName = desc.replace('Advance payment to ', '').split(' (')[0];
          } else if (/payroll/i.test(desc)) {
            // Company payroll BPV — party shown as company (payroll is not one vendor/employee)
            vName = e.companyId?.name || e.customCompany || '';
          }
        }
        return { ...e, vendorOrEmployeeName: vName || e.vendorOrEmployeeName };
      });
    } catch (enrichErr) {
      console.error('[journal-entries] enrichment failed; returning base entries:', enrichErr.message);
      finalEntries = entries.map((e) => (e.toObject ? e.toObject() : { ...e }));
    }

    // Safely enrich department ObjectId references with Department documents
    try {
      const Department = require('../models/hr/Department');
      const isDeptObjectId = (v) =>
        v != null &&
        v !== '' &&
        !(typeof v === 'object' && v.name) &&
        mongoose.Types.ObjectId.isValid(v) &&
        String(v).length === 24;

      const deptIds = new Set();
      finalEntries.forEach((e) => {
        if (isDeptObjectId(e.department)) deptIds.add(String(e.department));
        (e.lines || []).forEach((l) => {
          if (isDeptObjectId(l.department)) deptIds.add(String(l.department));
        });
      });

      if (deptIds.size > 0) {
        const depts = await Department.find({ _id: { $in: Array.from(deptIds) } }).select('name code').lean();
        const deptMap = new Map();
        depts.forEach((d) => deptMap.set(String(d._id), d));

        finalEntries.forEach((e) => {
          if (e.department && deptMap.has(String(e.department))) {
            e.department = deptMap.get(String(e.department));
          }
          (e.lines || []).forEach((l) => {
            if (l.department && deptMap.has(String(l.department))) {
              l.department = deptMap.get(String(l.department));
            }
          });
        });
      }
    } catch (deptErr) {
      console.error('[journal-entries] department enrichment failed:', deptErr.message);
    }

    res.json({
      success: true,
      data: {
        company,
        entries: finalEntries,
        pagination: {
          currentPage: parseInt(page),
          totalPages,
          totalCount,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1,
          limit: parseInt(limit)
        }
      }
    });
  })
);

// @route   GET /api/finance/journal-entries/by-bill/:billIdOrNumber
// @desc    Get bill journal entry (Voucher Type: BILL) linked to a bill ID or billNumber
// @access  Private (Finance and Admin)
router.get('/journal-entries/by-bill/:billIdOrNumber',
  authorize('super_admin', 'admin', 'finance_manager'),
  asyncHandler(async (req, res) => {
    const raw = String(req.params.billIdOrNumber || '').trim();
    if (!raw) return res.json({ success: true, data: null });

    const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const isOid = mongoose.Types.ObjectId.isValid(raw) && String(new mongoose.Types.ObjectId(raw)) === raw;
    const billMatch = [
      { reference: raw },
      { reference: { $regex: `^${escapeRegex(raw)}$`, $options: 'i' } }
    ];
    if (isOid) {
      billMatch.push({ referenceId: new mongoose.Types.ObjectId(raw) });
      billMatch.push({ referenceId: raw });
    }

    const billTypeMatch = {
      $or: [
        { referenceType: 'bill' },
        { voucherSeries: 'BILL' }
      ]
    };

    const populateBillJe = (q) =>
      q
        .populate('companyId', 'name companyCode')
        .populate('lines.account', 'accountNumber name type category')
        .populate('createdBy', 'firstName lastName')
        .populate('approvedBy', 'firstName lastName')
        .populate('project', 'name code')
        .populate('costCenter', 'name code')
        .lean();

    // IMPORTANT: use $and — a second top-level `$or` overwrites the first in a JS object
    // and previously returned an arbitrary BILL voucher (wrong bill in View Docs).
    let entry = await populateBillJe(
      JournalEntry.findOne({
        $and: [{ $or: billMatch }, billTypeMatch]
      }).sort({ createdAt: -1 })
    );

    if (!entry && isOid) {
      const AccountsPayable = require('../models/finance/AccountsPayable');
      const apDoc = await AccountsPayable.findById(raw).select('billNumber').lean();
      if (apDoc?.billNumber) {
        const bn = String(apDoc.billNumber).trim();
        entry = await populateBillJe(
          JournalEntry.findOne({
            $and: [
              {
                $or: [
                  { reference: bn },
                  { reference: { $regex: `^${escapeRegex(bn)}$`, $options: 'i' } },
                  { referenceId: apDoc._id },
                  { referenceId: String(apDoc._id) }
                ]
              },
              billTypeMatch
            ]
          }).sort({ createdAt: -1 })
        );
      }
    }

    res.json({ success: true, data: entry || null });
  })
);

// @route   GET /api/finance/journal-entries/:id
// @desc    Get single journal entry with populated lines
// @access  Private (Finance and Admin)
router.get('/journal-entries/:id',
  authorize('super_admin', 'admin', 'finance_manager'),
  asyncHandler(async (req, res) => {
    // Direct voucher links (payroll BPV, AP, etc.) must work even when the global
    // finance company selector differs from the voucher's owning company.
    const entry = await JournalEntry.findById(req.params.id)
      .populate('companyId', 'name companyCode')
      .populate('payingCompanyId', 'name companyCode')
      .populate('lines.account', 'accountNumber name type category')
      .populate('createdBy', 'firstName lastName')
      .populate('approvedBy', 'firstName lastName')
      .populate('project', 'name code')
      .populate('costCenter', 'name code');

    if (!entry) return res.status(404).json({ success: false, message: 'Journal entry not found' });

    // Normalize lines so the form receives { account: ObjectId-string, ... }
    // but also provide account details for display
    const normalized = entry.toObject();
    if (normalized.department && mongoose.Types.ObjectId.isValid(normalized.department)) {
      const Department = mongoose.model('Department');
      const deptDoc = await Department.findById(normalized.department).select('name code').lean();
      if (deptDoc) normalized.department = deptDoc;
    }

    // Resolve line-level party / department ObjectIds to names (refPath cannot
    // populate Vendor→Supplier / Customer→SalesCustomer).
    const { enrichPartyFields, enrichDepartmentFields } = require('../utils/financePartyResolve');
    if (Array.isArray(normalized.lines) && normalized.lines.length) {
      await enrichPartyFields(normalized.lines);
      await enrichDepartmentFields(normalized.lines, 'department');
    }

    if (normalized.module === 'payroll') {
      const PayrollPeriodPaymentHelper = require('../utils/payrollPeriodPayment');
      normalized.payrollVoucherSummary = await PayrollPeriodPaymentHelper.resolvePayrollVoucherSummaryForJournalEntry(entry._id);
    }
    res.json({ success: true, data: normalized });
  })
);

// @route   DELETE /api/finance/journal-entries/:id
// @desc    Delete a voucher and fully reverse its accounting + operational impact
// @access  Private (Developer)
router.delete('/journal-entries/:id',
  authorize('developer', 'super_admin', 'admin', 'finance_manager'),
  asyncHandler(async (req, res) => {
    // Check if the user is a developer
    const isDeveloper = req.user.role === 'developer' || (req.user.roles && req.user.roles.includes('developer'));
    if (!isDeveloper) {
      return res.status(403).json({ success: false, message: 'Only developers are authorized to delete vouchers.' });
    }

    const entry = await JournalEntry.findById(req.params.id);
    if (!entry) {
      return res.status(404).json({ success: false, message: 'Voucher not found' });
    }

    const { unwindJournalEntryOnDelete } = require('../utils/journalEntryDeleteUnwind');
    await unwindJournalEntryOnDelete(entry);

    res.json({
      success: true,
      message: 'Voucher deleted. Account balances, trial balance source, GL, and linked AR/AP/CA/banking/payroll records were reversed.'
    });
  })
);

/** Post draft BPV/CPV linked to a cash approval so Trial Balance includes it (legacy drafts + safety net). */
const postLinkedCashApprovalJournalIfDraft = async (entry, userId) => {
  if (!entry || entry.status !== 'draft') return entry;
  const linkedCashApproval = await CashApproval.findOne({
    $or: [{ voucherEntryId: entry._id }, { _id: entry.referenceId }]
  }).lean();
  if (!linkedCashApproval) return entry;
  await entry.post(userId);
  try {
    await FinanceHelper.postToGeneralLedger(entry._id);
  } catch (glErr) {
    console.warn('[CA voucher] General ledger post skipped:', glErr.message);
  }
  return JournalEntry.findById(entry._id);
};

// @route   PUT /api/finance/journal-entries/:id/clearance
// @desc    Mark/unmark voucher clearance status
// @access  Private (Finance and Admin)
router.put('/journal-entries/:id/clearance',
  authorize('super_admin', 'admin', 'finance_manager'),
  asyncHandler(async (req, res) => {
    const { clearanceStatus = 'pending', clearanceRemarks = '', clearedAt } = req.body || {};
    if (!['pending', 'cleared'].includes(clearanceStatus)) {
      return res.status(400).json({ success: false, message: 'Invalid clearance status' });
    }

    const entry = await JournalEntry.findById(req.params.id);
    if (!entry) return res.status(404).json({ success: false, message: 'Journal entry not found' });

    if (clearanceStatus === 'cleared') {
      if (!clearedAt || Number.isNaN(new Date(clearedAt).getTime())) {
        return res.status(400).json({
          success: false,
          message: 'Clearance date is required when marking as cleared. Send clearedAt (ISO or parseable date).'
        });
      }
      await postLinkedCashApprovalJournalIfDraft(entry, req.user._id);
    }

    entry.clearanceStatus = clearanceStatus;
    if (clearanceStatus === 'cleared') {
      entry.clearedAt = new Date(clearedAt);
      entry.clearedBy = req.user._id;
      entry.clearanceRemarks = clearanceRemarks || '';
    } else {
      entry.clearedAt = null;
      entry.clearedBy = null;
      entry.clearanceRemarks = clearanceRemarks || '';
    }
    await entry.save();

    const updated = await JournalEntry.findById(entry._id)
      .populate('clearedBy', 'firstName lastName email');
    return res.json({
      success: true,
      message: `Voucher marked as ${clearanceStatus}`,
      data: updated
    });
  })
);

// @route   PUT /api/finance/journal-entries/:id/signed-document
// @desc    Mark/unmark voucher signed document status
// @access  Private (Finance and Admin)
router.put('/journal-entries/:id/signed-document',
  authorize('super_admin', 'admin', 'finance_manager'),
  asyncHandler(async (req, res) => {
    const { signedDocumentStatus = 'not_signed', signedDocumentAt, signedBySignatory } = req.body || {};
    if (!['signed', 'not_signed'].includes(signedDocumentStatus)) {
      return res.status(400).json({ success: false, message: 'Invalid signed document status' });
    }

    const entry = await JournalEntry.findById(req.params.id);
    if (!entry) return res.status(404).json({ success: false, message: 'Journal entry not found' });

    entry.signedDocumentStatus = signedDocumentStatus;
    if (signedBySignatory !== undefined) {
      entry.signedBySignatory = signedBySignatory || null;
    }
    if (signedDocumentStatus === 'signed') {
      entry.signedDocumentAt = signedDocumentAt ? new Date(signedDocumentAt) : (entry.signedDocumentAt || new Date());
    } else {
      entry.signedDocumentAt = null;
      entry.signedBySignatory = null;
    }
    await entry.save();

    // Cash-approval BPV/CPV: ensure posted to GL (Trial Balance) when signed; then sync Advance Issued.
    if (signedDocumentStatus === 'signed') {
      await postLinkedCashApprovalJournalIfDraft(entry, req.user._id);
      const linkedCashApproval = await CashApproval.findOne({
        $or: [
          { voucherEntryId: entry._id },
          { _id: entry.referenceId }
        ]
      });
      const freshEntry = await JournalEntry.findById(entry._id).select('status').lean();
      if (
        linkedCashApproval &&
        freshEntry?.status === 'posted' &&
        linkedCashApproval.status !== 'Advance Issued'
      ) {
        linkedCashApproval.status = 'Advance Issued';
        if (!linkedCashApproval.advanceIssuedAt) linkedCashApproval.advanceIssuedAt = new Date();
        if (!linkedCashApproval.advanceIssuedBy) linkedCashApproval.advanceIssuedBy = req.user._id;
        linkedCashApproval.updatedBy = req.user._id;
        await linkedCashApproval.save();
      }

      const linkedVendorAdvance = await VendorAdvance.findOne({
        $or: [{ journalEntryId: entry._id }, { payingJournalEntryId: entry._id }]
      }).lean();
      if (linkedVendorAdvance) {
        await tryAutoApprovePoAfterVendorAdvance(linkedVendorAdvance, req.user._id);
      }
    }

    const updated = await JournalEntry.findById(entry._id);
    return res.json({
      success: true,
      message: `Voucher marked as ${signedDocumentStatus === 'signed' ? 'signed' : 'not signed'}`,
      data: updated
    });
  })
);

// @route   POST /api/finance/journal-entries
// @desc    Create new journal entry
// @access  Private (Finance and Admin)
router.post('/journal-entries',
  authorize('super_admin', 'admin', 'finance_manager'),
  [
    body('description').trim().notEmpty().withMessage('Description is required'),
    body('department').optional(),
    body('module').optional(),
    body('project').optional().custom((val) => {
      if (val === '' || val === null || val === undefined) return true;
      return require('mongoose').Types.ObjectId.isValid(val);
    }).withMessage('Valid project ID is required'),
    body('lines').isArray({ min: 2 }).withMessage('At least 2 lines are required'),
    body('lines.*.account').isMongoId().withMessage('Valid account is required for each line'),
    body('lines.*.debit').isFloat({ min: 0 }).withMessage('Debit amount must be non-negative'),
    body('lines.*.credit').isFloat({ min: 0 }).withMessage('Credit amount must be non-negative')
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      console.error("Journal Entry Validation Error:", JSON.stringify(errors.array(), null, 2));
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array(),
        errors: errors.array()
      });
    }

    let company = null;
    const reqCompanyRaw = req.body.companyId || req.query.companyId || req.headers['x-finance-company-id'];
    if (reqCompanyRaw && reqCompanyRaw !== 'all') {
      try {
        company = await resolveCompanyId(reqCompanyRaw);
      } catch (e) { }
    }
    if (!company || company.isAll) {
      try {
        company = await requireCompanyFromRequest(req);
      } catch (e) {
        company = await findHistoricalCompany();
      }
    }

    const accountIdsRaw = (req.body.lines || []).map((line) => line.account).filter(Boolean);
    const accountIds = [...new Set(accountIdsRaw)];
    const accountFilter = {
      _id: { $in: accountIds },
      isActive: true
    };
    if (company && company._id && !company.isAll) {
      accountFilter.$or = [
        { companyId: company._id },
        { companyId: null },
        { companyId: { $exists: false } }
      ];
    }
    const matchedAccounts = await Account.countDocuments(accountFilter);
    if (matchedAccounts !== accountIds.length) {
      return res.status(400).json({
        success: false,
        message: 'All journal lines must use accounts from the selected finance company'
      });
    }

    const entryData = {
      ...req.body,
      companyId: (company && !company.isAll) ? company._id : (req.body.companyId && req.body.companyId !== 'all' ? req.body.companyId : null),
      createdBy: req.user._id
    };
    if (!entryData.companyId) {
      const hist = await findHistoricalCompany();
      if (hist) entryData.companyId = hist._id;
    }

    if (entryData.referenceId === '') {
      entryData.referenceId = null;
    }
    if (entryData.project === '') {
      entryData.project = null;
    }
    if (entryData.department === '') {
      entryData.department = null;
    }
    if (entryData.costCenter === '') {
      entryData.costCenter = null;
    }
    if (entryData.lines) {
      entryData.lines = entryData.lines.map(line => {
        const newLine = {
          account: line.account?._id || line.account || null,
          reference: line.reference || '',
          description: line.description || '',
          debit: Number(line.debit) || 0,
          credit: Number(line.credit) || 0,
          department: line.department === '' ? null : (line.department?._id || line.department || null),
          costCenter: line.costCenter === '' ? null : (line.costCenter?._id || line.costCenter || null),
          partyType: line.partyType === '' || line.partyType == null ? undefined : line.partyType,
          party: line.party === '' || line.party == null ? undefined : (line.party?._id || line.party)
        };
        return newLine;
      });
    }

    const entry = new JournalEntry(entryData);
    await entry.save();

    res.status(201).json({
      success: true,
      message: 'Journal entry created successfully',
      data: entry
    });
  })
);

// @route   PUT /api/finance/journal-entries/:id/reference
// @desc    Update Journal Entry reference globally (cascades to GL, Banking, AP, Advances)
// @access  Private (Finance and Admin)
router.put('/journal-entries/:id/reference',
  authorize('super_admin', 'admin', 'finance_manager'),
  asyncHandler(async (req, res) => {
    const { reference } = req.body;
    if (!reference) return res.status(400).json({ success: false, message: 'Reference is required' });

    const entry = await JournalEntry.findById(req.params.id);
    if (!entry) return res.status(404).json({ success: false, message: 'Journal entry not found' });

    const oldReference = entry.reference;
    entry.reference = reference;
    await entry.save();

    // 1. Update GeneralLedger
    await mongoose.model('GeneralLedger').updateMany({ journalEntry: entry._id }, { reference });

    // 2. Update Banking
    const Banking = mongoose.model('Banking');
    await Banking.updateMany(
      { 'transactions.journalEntry': entry._id },
      { $set: { 'transactions.$[elem].reference': reference } },
      { arrayFilters: [{ 'elem.journalEntry': entry._id }] }
    );
    
    if (oldReference) {
      await Banking.updateMany(
        { 'transactions.reference': oldReference },
        { $set: { 'transactions.$[elem].reference': reference } },
        { arrayFilters: [{ 'elem.reference': oldReference }] }
      );
    }

    // 3. Trace back to source document
    if (entry.referenceType === 'payment' && entry.referenceId) {
      const ApPaymentApp = mongoose.model('ApPaymentApplication');
      const AccountsPayable = mongoose.model('AccountsPayable');
      
      const app = await ApPaymentApp.findById(entry.referenceId);
      if (app) {
        app.paymentMeta = app.paymentMeta || {};
        const appOldRef = app.paymentMeta.reference || oldReference;
        app.paymentMeta.reference = reference;
        await ApPaymentApp.updateOne({ _id: app._id }, { $set: { paymentMeta: app.paymentMeta } });

        if (appOldRef) {
          await AccountsPayable.updateMany(
            { 'payments.reference': appOldRef },
            { $set: { 'payments.$[elem].reference': reference } },
            { arrayFilters: [{ 'elem.reference': appOldRef }] }
          );
        }
      }
    
    } else if (entry.referenceType === 'receipt' && entry.referenceId) {
      const AccountsReceivable = require('../models/finance/AccountsReceivable');
      // If there's an old reference, update the exact payment
      if (oldReference) {
        await AccountsReceivable.updateMany(
          { _id: entry.referenceId, 'payments.reference': oldReference },
          { $set: { 'payments.$[elem].reference': reference } },
          { arrayFilters: [{ 'elem.reference': oldReference }] }
        );
      } else {
        // If no old reference, we just update the first payment without a reference that matches the amount?
        // A simpler brute force since we know the invoice: just update any blank references to the new cheque number.
        // Or we can just set all blank references to this cheque number if it matches the total.
        await AccountsReceivable.updateMany(
          { _id: entry.referenceId, 'payments.reference': { $in: [null, ''] } },
          { $set: { 'payments.$[elem].reference': reference } },
          { arrayFilters: [{ 'elem.reference': { $in: [null, ''] } }] }
        );
      }
    } else if (entry.referenceType === 'vendor_advance' && entry.referenceId) {
      const VendorAdvance = mongoose.model('VendorAdvance');
      await VendorAdvance.updateOne(
        { _id: entry.referenceId },
        { $set: { reference: reference, chequeNumber: reference } }
      );
    }

    res.json({ success: true, message: 'Reference updated globally', data: entry });
  })
);

// @route   PUT /api/finance/journal-entries/:id
// @route   PUT /api/finance/journal-entries/:id
// @desc    Update/edit a journal entry (draft or posted)
// @access  Private (Finance and Admin)
router.put('/journal-entries/:id',
  authorize('super_admin', 'admin', 'finance_manager'),
  [
    body('description').trim().notEmpty().withMessage('Description is required'),
    body('department').optional(),
    body('module').optional(),
    body('project').optional().custom((val) => {
      if (val === '' || val === null || val === undefined) return true;
      return require('mongoose').Types.ObjectId.isValid(val);
    }).withMessage('Valid project ID is required'),
    body('lines').isArray({ min: 2 }).withMessage('At least 2 lines are required'),
    body('lines.*.account').isMongoId().withMessage('Valid account is required for each line'),
    body('lines.*.debit').isFloat({ min: 0 }).withMessage('Debit amount must be non-negative'),
    body('lines.*.credit').isFloat({ min: 0 }).withMessage('Credit amount must be non-negative')
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      console.error("Journal Entry Validation Error (PUT):", JSON.stringify(errors.array(), null, 2));
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array(),
        errors: errors.array()
      });
    }

    const entry = await JournalEntry.findById(req.params.id);
    if (!entry) {
      return res.status(404).json({
        success: false,
        message: 'Journal entry not found'
      });
    }

    if (entry.status === 'reversed' || entry.isReversed) {
      return res.status(400).json({
        success: false,
        message: 'Reversed journal entries cannot be edited'
      });
    }

    if (entry.status !== 'draft' && entry.status !== 'posted') {
      return res.status(400).json({
        success: false,
        message: `Entries with status "${entry.status}" cannot be edited`
      });
    }

    let company = null;
    const reqCompanyRaw = req.body.companyId || req.query.companyId || req.headers['x-finance-company-id'];
    if (reqCompanyRaw && reqCompanyRaw !== 'all') {
      try {
        company = await resolveCompanyId(reqCompanyRaw);
      } catch (e) { }
    }
    if ((!company || company.isAll) && entry.companyId) {
      try {
        company = await resolveCompanyId(entry.companyId);
      } catch (e) { }
    }
    if (!company || company.isAll) {
      try {
        company = await requireCompanyFromRequest(req);
      } catch (e) {
        company = await findHistoricalCompany();
      }
    }

    const accountIdsRaw = (req.body.lines || []).map((line) => line.account).filter(Boolean);
    const accountIds = [...new Set(accountIdsRaw)];
    const accountFilter = {
      _id: { $in: accountIds },
      isActive: true
    };
    if (company && company._id && !company.isAll) {
      accountFilter.$or = [
        { companyId: company._id },
        { companyId: null },
        { companyId: { $exists: false } }
      ];
    }
    const matchedAccounts = await Account.countDocuments(accountFilter);
    if (matchedAccounts !== accountIds.length) {
      return res.status(400).json({
        success: false,
        message: 'All journal lines must use accounts from the selected finance company'
      });
    }

    if (company && company._id && !company.isAll) {
      entry.companyId = company._id;
    }

    const wasPosted = entry.status === 'posted';
    const oldLines = entry.lines ? entry.lines.map((l) => ({
      account: l.account?._id || l.account,
      debit: Number(l.debit) || 0,
      credit: Number(l.credit) || 0
    })) : [];

    entry.description = req.body.description;
    entry.department = req.body.department === '' ? null : (req.body.department || null);
    entry.costCenter = req.body.costCenter === '' ? null : (req.body.costCenter || null);
    entry.module = req.body.module || 'general';
    entry.reference = req.body.reference || '';
    entry.referenceId = req.body.referenceId === '' ? null : (req.body.referenceId || entry.referenceId);
    entry.project = req.body.project === '' ? null : (req.body.project || null);
    if (req.body.date) {
      entry.date = new Date(req.body.date);
    }
    if (req.body.lines) {
      entry.lines = req.body.lines.map((line) => {
        const newLine = {
          account: line.account?._id || line.account || null,
          reference: line.reference || '',
          description: line.description || '',
          debit: Number(line.debit) || 0,
          credit: Number(line.credit) || 0,
          department: line.department === '' ? null : (line.department?._id || line.department || null),
          costCenter: line.costCenter === '' ? null : (line.costCenter?._id || line.costCenter || null),
          partyType: line.partyType === '' || line.partyType == null ? undefined : line.partyType,
          party: line.party === '' || line.party == null ? undefined : (line.party?._id || line.party)
        };
        return newLine;
      });
    }

    if (wasPosted) {
      // 1. Revert previous impact on account balances
      for (const oldLine of oldLines) {
        if (oldLine.account) {
          const delta = oldLine.debit - oldLine.credit;
          await Account.findByIdAndUpdate(oldLine.account, {
            $inc: { balance: -delta }
          });
        }
      }

      // 2. Save the journal entry (the post-save hook will apply new line balances because status is posted)
      await entry.save();

      // 3. Refresh General Ledger entries
      try {
        await GeneralLedger.deleteMany({ journalEntry: entry._id });
        await FinanceHelper.postToGeneralLedger(entry._id);
      } catch (glErr) {
        console.warn('[Journal update] General ledger sync error:', glErr.message);
      }
    } else {
      await entry.save();
    }

    res.json({
      success: true,
      message: 'Journal entry updated successfully',
      data: entry
    });
  })
);

// @route   PUT /api/finance/journal-entries/:id/post
// @desc    Post a journal entry
// @access  Private (Finance and Admin)
router.put('/journal-entries/:id/post',
  authorize('super_admin', 'admin', 'finance_manager'),
  asyncHandler(async (req, res) => {
    const entry = await JournalEntry.findById(req.params.id);
    if (!entry) {
      return res.status(404).json({
        success: false,
        message: 'Journal entry not found'
      });
    }

    if (entry.status !== 'draft') {
      return res.status(400).json({
        success: false,
        message: 'Only draft entries can be posted'
      });
    }

    await entry.post(req.user._id);
    try {
      await FinanceHelper.postToGeneralLedger(entry._id);
    } catch (glErr) {
      console.warn('[Journal post] General ledger post skipped:', glErr.message);
    }

    res.json({
      success: true,
      message: 'Journal entry posted successfully',
      data: entry
    });
  })
);

// @route   PUT /api/finance/journal-entries/:id/finance-approve
// @desc    Record authority approval for manual journal entries
// @access  Private (Finance and Admin)
router.put('/journal-entries/:id/finance-approve',
  authorize('super_admin', 'admin', 'finance_manager'),
  asyncHandler(async (req, res) => {
    const entry = await JournalEntry.findById(req.params.id);
    if (!entry) return res.status(404).json({ success: false, message: 'Journal entry not found' });
    if (entry.status !== 'draft') {
      return res.status(400).json({
        success: false,
        message: 'Authority approval only applies to draft journal entries'
      });
    }
    const slots = getRequiredFinanceAuthoritySlots(entry);
    if (!slots.length) {
      return res.status(400).json({ success: false, message: 'Finance approval authorities are not configured on this entry' });
    }
    const matchedSlots = matchUserToFinanceSlots(slots, req.user);
    if (!matchedSlots.length) {
      return res.status(403).json({ success: false, message: 'Your user is not assigned as a finance authority for this entry' });
    }
    const approvals = Array.isArray(entry.financeAuthorityApprovals) ? [...entry.financeAuthorityApprovals] : [];
    const approvedKeys = new Set(
      approvals
        .filter((a) => String(a?.decision || 'approved').trim() !== 'rejected')
        .map((a) => String(a?.authorityKey || '').trim())
        .filter(Boolean)
    );
    const pendingMatchedSlots = matchedSlots.filter((slot) => !approvedKeys.has(slot.key));
    if (!pendingMatchedSlots.length) {
      return res.status(400).json({ success: false, message: 'You have already approved your assigned finance authority slot' });
    }
    const now = new Date();
    pendingMatchedSlots.forEach((slot) => {
      approvals.push({
        authorityKey: slot.key,
        authorityLabel: slot.label,
        approver: req.user._id,
        decision: 'approved',
        approvedAt: now,
        comments: req.body?.comments || ''
      });
    });
    entry.financeAuthorityApprovals = approvals;
    await entry.save();

    const requiredKeys = new Set(slots.map((s) => s.key));
    const approvedNow = new Set(
      entry.financeAuthorityApprovals
        .filter((a) => String(a?.decision || 'approved').trim() !== 'rejected')
        .map((a) => String(a?.authorityKey || '').trim())
        .filter(Boolean)
    );
    const remaining = [...requiredKeys].filter((k) => !approvedNow.has(k)).length;

    if (remaining === 0) {
      // Auto-post when fully signed
      await entry.post(req.user._id);
      try {
        await FinanceHelper.postToGeneralLedger(entry._id);
      } catch (glErr) {
        console.warn('[Journal post via auth] GL post skipped:', glErr.message);
      }
    }

    res.json({
      success: true,
      message: remaining === 0 ? 'Journal entry fully approved and posted' : 'Approval recorded successfully',
      data: entry
    });
  })
);

// @route   PUT /api/finance/journal-entries/:id/finance-reject
// @desc    Record authority rejection for manual journal entries
// @access  Private (Finance and Admin)
router.put('/journal-entries/:id/finance-reject',
  authorize('super_admin', 'admin', 'finance_manager'),
  asyncHandler(async (req, res) => {
    const entry = await JournalEntry.findById(req.params.id);
    if (!entry) return res.status(404).json({ success: false, message: 'Journal entry not found' });
    if (entry.status !== 'draft') {
      return res.status(400).json({
        success: false,
        message: 'Only draft journal entries can be rejected'
      });
    }
    const slots = getRequiredFinanceAuthoritySlots(entry);
    const matchedSlots = matchUserToFinanceSlots(slots, req.user);
    if (!matchedSlots.length) {
      return res.status(403).json({ success: false, message: 'Your user is not assigned as a finance authority for this entry' });
    }
    const comments = req.body?.comments || '';
    if (!comments.trim()) {
      return res.status(400).json({ success: false, message: 'Observation comments are required for rejection' });
    }

    // Cancel / reject the entry
    entry.status = 'cancelled';
    const approvals = Array.isArray(entry.financeAuthorityApprovals) ? [...entry.financeAuthorityApprovals] : [];
    matchedSlots.forEach((slot) => {
      approvals.push({
        authorityKey: slot.key,
        authorityLabel: slot.label,
        approver: req.user._id,
        decision: 'rejected',
        approvedAt: new Date(),
        comments
      });
    });
    entry.financeAuthorityApprovals = approvals;
    await entry.save();

    res.json({
      success: true,
      message: 'Journal entry rejected and marked cancelled',
      data: entry
    });
  })
);

// ================================
// GENERAL LEDGER ROUTES
// ================================

// @route   GET /api/finance/general-ledger
// @desc    Get general ledger entries
// @access  Private (Finance and Admin)
router.get('/general-ledger', 
  authorize('super_admin', 'admin', 'finance_manager'), 
  asyncHandler(async (req, res) => {
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    const { 
      page = 1, 
      limit = 20, 
      accountId,
      department,
      module,
      startDate,
      endDate,
      search 
    } = req.query;

    const filters = { status: 'posted' };

    let company = null;
    try {
      company = await requireCompanyFromRequest(req);
    } catch (err) {
      company = await findHistoricalCompany();
      if (!company) throw err;
    }
    if (company?._id) {
      filters.companyId = company._id;
    }

    if (accountId) filters.account = accountId;
    if (department) filters.department = department;
    if (module) filters.module = module;
    if (search) {
      filters.$or = [
        { entryNumber: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { reference: { $regex: search, $options: 'i' } }
      ];
    }
    if (startDate || endDate) {
      filters.date = {};
      if (startDate) {
        const start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
        filters.date.$gte = start;
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        filters.date.$lte = end;
      }
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const pageNum = parseInt(page, 10) || 1;
    const limitNum = parseInt(limit, 10) || 20;

    // Per-account view: recompute running balance from opening (FY-correct).
    // All-accounts view: do not expose stored runningBalance (misleading across accounts).
    if (accountId) {
      let start = null;
      let end = null;
      if (startDate) {
        start = new Date(startDate);
        if (!Number.isNaN(start.getTime())) start.setHours(0, 0, 0, 0);
        else start = null;
      }
      if (endDate) {
        end = new Date(endDate);
        if (!Number.isNaN(end.getTime())) end.setHours(23, 59, 59, 999);
        else end = null;
      }

      const ledger = await GeneralLedger.getAccountLedger(
        accountId,
        start,
        end,
        company?._id || null
      );
      let entries = Array.isArray(ledger?.entries) ? ledger.entries : [];

      // Optional secondary filters on the account ledger
      if (department) {
        entries = entries.filter((e) => String(e.department || '').toLowerCase() === String(department).toLowerCase());
      }
      if (module) {
        entries = entries.filter((e) => String(e.module || '').toLowerCase() === String(module).toLowerCase());
      }
      if (search) {
        const q = String(search).toLowerCase();
        entries = entries.filter((e) => {
          const hay = `${e.entryNumber || ''} ${e.description || ''} ${e.reference || ''}`.toLowerCase();
          return hay.includes(q);
        });
        // Recompute running balance after search filter would break continuity —
        // search on account ledger still keeps chronological running from opening.
      }

      const totalCount = entries.length;
      const totalPages = Math.max(1, Math.ceil(totalCount / limitNum));
      const pageEntries = entries.slice(skip, skip + limitNum);

      return res.json({
        success: true,
        data: {
          company,
          entries: pageEntries,
          openingBalance: ledger.openingBalance || 0,
          closingBalance: ledger.closingBalance || 0,
          balanceAccountId: accountId,
          pagination: {
            currentPage: pageNum,
            totalPages,
            totalCount,
            hasNextPage: pageNum < totalPages,
            hasPrevPage: pageNum > 1,
            limit: limitNum
          }
        }
      });
    }

    const [entriesRaw, totalCount] = await Promise.all([
      GeneralLedger.find(filters)
        .populate('account', 'accountNumber name type')
        .populate('journalEntry', 'entryNumber reference description')
        .populate('createdBy', 'firstName lastName')
        .sort({ date: 1, entryNumber: 1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      GeneralLedger.countDocuments(filters)
    ]);

    // Strip misleading stored balances on mixed-account list
    const entries = (entriesRaw || []).map((e) => {
      const { runningBalance, ...rest } = e;
      return { ...rest, runningBalance: null };
    });

    const totalPages = Math.ceil(totalCount / limitNum) || 1;

    res.json({
      success: true,
      data: {
        company,
        entries,
        openingBalance: null,
        closingBalance: null,
        balanceAccountId: null,
        pagination: {
          currentPage: pageNum,
          totalPages,
          totalCount,
          hasNextPage: pageNum < totalPages,
          hasPrevPage: pageNum > 1,
          limit: limitNum
        }
      }
    });
  })
);

// @route   GET /api/finance/general-ledger/account/:id
// @desc    Get ledger for specific account
// @access  Private (Finance and Admin)
router.get('/general-ledger/account/:id', 
  authorize('super_admin', 'admin', 'finance_manager'), 
  asyncHandler(async (req, res) => {
    const { startDate, endDate, companyId: queryCompanyId } = req.query;
    // Match trial-balance-v2: full local calendar day for from/to (date-only query strings).
    let start = null;
    let end = null;
    if (startDate) {
      start = new Date(startDate);
      if (!Number.isNaN(start.getTime())) start.setHours(0, 0, 0, 0);
      else start = null;
    }
    if (endDate) {
      end = new Date(endDate);
      if (!Number.isNaN(end.getTime())) end.setHours(23, 59, 59, 999);
      else end = null;
    }

    let companyId = queryCompanyId || null;
    if (!companyId) {
      try {
        const company = await requireCompanyFromRequest(req);
        companyId = company?._id || null;
      } catch (_) {
        companyId = null;
      }
    }

    const ledger = await GeneralLedger.getAccountLedger(req.params.id, start, end, companyId);
    const entries = Array.isArray(ledger?.entries) ? ledger.entries : [];

    res.json({
      success: true,
      data: entries,
      openingBalance: ledger?.openingBalance || 0,
      closingBalance: ledger?.closingBalance || 0
    });
  })
);

// ================================
// ACCOUNTS RECEIVABLE ROUTES
// ================================

// @route   GET /api/finance/accounts-receivable
// @desc    Get all accounts receivable
// @access  Private (Finance and Admin)
router.get('/accounts-receivable', 
  authorize('super_admin', 'admin', 'finance_manager'), 
  asyncHandler(async (req, res) => {
    const { 
      page = 1, 
      limit = 20, 
      status,
      customerId,
      customer,
      startDate,
      endDate,
      search 
    } = req.query;

    const company = await resolveCompanyForFinanceRoute(req);
    const baseFilters = {};

    if (status) baseFilters.status = status;
    if (customerId) {
      baseFilters['customer.customerId'] = customerId;
    } else if (customer && String(customer).trim()) {
      baseFilters['customer.name'] = {
        $regex: escapeRegex(String(customer).trim()),
        $options: 'i'
      };
    }
    if (search && String(search).trim()) {
      const escaped = escapeRegex(String(search).trim());
      baseFilters.$or = [
        { invoiceNumber: { $regex: escaped, $options: 'i' } },
        { 'customer.name': { $regex: escaped, $options: 'i' } },
        { 'customer.email': { $regex: escaped, $options: 'i' } }
      ];
    }
    if (startDate || endDate) {
      baseFilters.invoiceDate = {};
      if (startDate) {
        const start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
        baseFilters.invoiceDate.$gte = start;
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        baseFilters.invoiceDate.$lte = end;
      }
    }

    // Only Finance Customers (SalesCustomer) invoices — hide Taj/legacy AR parties
    const SalesCustomer = require('../models/sales/SalesCustomer');
    const salesCustomers = await SalesCustomer.find({}).select('_id name').lean();
    const salesIds = salesCustomers.map((c) => c._id);
    const salesNames = salesCustomers.map((c) => c.name).filter(Boolean);
    if (!salesIds.length && !salesNames.length) {
      return res.json({
        success: true,
        data: {
          invoices: [],
          pagination: {
            currentPage: parseInt(page, 10) || 1,
            totalPages: 1,
            totalCount: 0,
            hasNextPage: false,
            hasPrevPage: false,
            limit: parseInt(limit, 10) || 20
          },
          summary: {
            totalOutstanding: 0,
            totalOverdue: 0,
            totalPaid: 0,
            totalInvoices: 0
          }
        }
      });
    }
    const financeCustomerMatch = {
      $or: [
        ...(salesIds.length ? [{ 'customer.customerId': { $in: salesIds } }] : []),
        ...(salesNames.length ? [{ 'customer.name': { $in: salesNames } }] : [])
      ]
    };
    const scopedBase = Object.keys(baseFilters).length
      ? { $and: [baseFilters, financeCustomerMatch] }
      : financeCustomerMatch;

    // Legacy AR rows often have companyId=null — include them with the selected company
    let filters;
    if (!company?._id || company.isAll || isHistoricalCompany(company)) {
      filters = companyQuery(scopedBase, company);
    } else {
      const companyFilter = {
        $or: [
          { companyId: company._id },
          { companyId: null },
          { companyId: { $exists: false } }
        ]
      };
      filters = { $and: [scopedBase, companyFilter] };
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const limitNum = parseInt(limit, 10) || 20;
    const pageNum = parseInt(page, 10) || 1;
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [invoices, totalCount, summaryResult] = await Promise.all([
      AccountsReceivable.find(filters)
        .populate('costCenter', 'name code')
        .sort({ invoiceDate: -1 })
        .skip(skip)
        .limit(limitNum),
      AccountsReceivable.countDocuments(filters),
      AccountsReceivable.aggregate([
        { $match: filters },
        {
          $addFields: {
            _received: {
              $max: [
                { $ifNull: ['$amountPaid', 0] },
                { $ifNull: ['$paidAmount', 0] },
                {
                  $reduce: {
                    input: { $ifNull: ['$payments', []] },
                    initialValue: 0,
                    in: { $add: ['$$value', { $ifNull: ['$$this.amount', 0] }] }
                  }
                },
                {
                  $reduce: {
                    input: { $ifNull: ['$installments', []] },
                    initialValue: 0,
                    in: { $add: ['$$value', { $ifNull: ['$$this.paidAmount', 0] }] }
                  }
                }
              ]
            }
          }
        },
        {
          $addFields: {
            _balance: {
              $max: [
                {
                  $subtract: [{ $ifNull: ['$totalAmount', 0] }, '$_received']
                },
                0
              ]
            },
            _hasInstallments: {
              $gt: [{ $size: { $ifNull: ['$installments', []] } }, 0]
            }
          }
        },
        {
          $addFields: {
            // Overdue Amount mirrors Invoice Details:
            // - with installments: sum of overdue/partial-past-due installment balances
            // - without: full outstanding if the invoice itself is overdue
            _overdueAmount: {
              $cond: [
                '$_hasInstallments',
                {
                  $reduce: {
                    input: { $ifNull: ['$installments', []] },
                    initialValue: 0,
                    in: {
                      $let: {
                        vars: {
                          instBal: {
                            $max: [
                              {
                                $subtract: [
                                  { $ifNull: ['$$this.amount', 0] },
                                  { $ifNull: ['$$this.paidAmount', 0] }
                                ]
                              },
                              0
                            ]
                          },
                          instStatus: { $ifNull: ['$$this.status', 'pending'] },
                          instDue: '$$this.dueDate'
                        },
                        in: {
                          $add: [
                            '$$value',
                            {
                              $cond: [
                                {
                                  $and: [
                                    { $gt: ['$$instBal', 0] },
                                    { $ne: ['$$instStatus', 'paid'] },
                                    { $ne: ['$$instStatus', 'cancelled'] },
                                    {
                                      $or: [
                                        { $eq: ['$$instStatus', 'overdue'] },
                                        {
                                          $and: [
                                            { $ne: ['$$instDue', null] },
                                            { $lt: ['$$instDue', today] }
                                          ]
                                        }
                                      ]
                                    }
                                  ]
                                },
                                '$$instBal',
                                0
                              ]
                            }
                          ]
                        }
                      }
                    }
                  }
                },
                {
                  $cond: [
                    {
                      $and: [
                        { $ne: ['$status', 'cancelled'] },
                        { $ne: ['$status', 'paid'] },
                        { $gt: ['$_balance', 0] },
                        {
                          $or: [
                            { $eq: ['$status', 'overdue'] },
                            {
                              $and: [
                                { $ne: ['$dueDate', null] },
                                { $lt: ['$dueDate', today] }
                              ]
                            }
                          ]
                        }
                      ]
                    },
                    '$_balance',
                    0
                  ]
                }
              ]
            }
          }
        },
        {
          $group: {
            _id: null,
            totalOutstanding: {
              $sum: {
                $cond: [
                  { $in: ['$status', ['cancelled']] },
                  0,
                  '$_balance'
                ]
              }
            },
            totalPaid: { $sum: '$_received' },
            totalOverdue: { $sum: '$_overdueAmount' }
          }
        }
      ])
    ]);

    const totalPages = Math.ceil(totalCount / limitNum) || 1;
    const summaryRow = summaryResult[0] || {};
    const summary = {
      totalOutstanding: Math.round((summaryRow.totalOutstanding || 0) * 100) / 100,
      totalOverdue: Math.round((summaryRow.totalOverdue || 0) * 100) / 100,
      totalPaid: Math.round((summaryRow.totalPaid || 0) * 100) / 100,
      totalInvoices: totalCount
    };

    res.json({
      success: true,
      data: {
        invoices,
        pagination: {
          currentPage: pageNum,
          totalPages,
          totalCount,
          hasNextPage: pageNum < totalPages,
          hasPrevPage: pageNum > 1,
          limit: limitNum
        },
        summary
      }
    });
  })
);

// @route   GET /api/finance/accounts-receivable/aging
// @desc    Get accounts receivable aging report
// @access  Private (Finance and Admin)
router.get('/accounts-receivable/aging', 
  authorize('super_admin', 'admin', 'finance_manager'), 
  asyncHandler(async (req, res) => {
    const { q } = await financeScope(req);
    const agingReport = await AccountsReceivable.getAgingReport(q({}));
    res.json({
      success: true,
      data: agingReport
    });
  })
);

// @route   POST /api/finance/accounts-receivable
// @desc    Create new invoice
// @access  Private (Finance and Admin)
router.post('/accounts-receivable',
  authorize('super_admin', 'admin', 'finance_manager'),
  [
    body('customer.name').trim().notEmpty().withMessage('Customer name is required'),
    body('invoiceNumber').trim().notEmpty().withMessage('Invoice number is required'),
    body('totalAmount').isFloat({ min: 0 }).withMessage('Total amount must be non-negative'),
    body('lineItems').isArray({ min: 1 }).withMessage('At least one line item is required'),
    body('costCenter').notEmpty().withMessage('Cost center is required').isMongoId().withMessage('Valid cost center is required')
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      console.error("Journal Entry Validation Error (PUT):", JSON.stringify(errors.array(), null, 2));
      return res.status(400).json({
        success: false,
        message: errors.array()[0]?.msg || 'Validation failed',
        errors: errors.array()
      });
    }

    // Use FinanceHelper to create AR and post to GL
    const company = await resolveCompanyForFinanceRoute(req);
    const FinanceCostCenter = require('../models/finance/CostCenter');
    const costCenterDoc = await FinanceCostCenter.findById(req.body.costCenter);
    if (!costCenterDoc) {
      return res.status(400).json({
        success: false,
        message: 'Cost center not found'
      });
    }
    if (
      company?._id &&
      costCenterDoc.companyId &&
      String(costCenterDoc.companyId) !== String(company._id)
    ) {
      return res.status(400).json({
        success: false,
        message: 'Cost center does not belong to the selected company'
      });
    }
    if (costCenterDoc.isActive === false) {
      return res.status(400).json({
        success: false,
        message: 'Selected cost center is inactive'
      });
    }

    const lineItems = (req.body.lineItems || []).map(item => ({
      description: item.description || 'Line Item',
      quantity: Number(item.quantity) || 1,
      unitPrice: Number(item.unitPrice) || Number(item.amount) || 0,
      amount: Number(item.amount) || (Number(item.quantity || 1) * Number(item.unitPrice || 0)),
      account: item.account || null
    }));

    const arEntry = await FinanceHelper.createARFromInvoice({
      companyId: company._id,
      customerName: req.body.customer.name,
      customerEmail: req.body.customer.email || '',
      customerId: req.body.customer.customerId || null,
      invoiceNumber: req.body.invoiceNumber,
      invoiceDate: req.body.invoiceDate,
      dueDate: req.body.dueDate,
      amount: req.body.totalAmount,
      department: req.body.department || 'general',
      costCenter: costCenterDoc._id,
      module: req.body.module || 'general',
      referenceId: req.body.referenceId || null,
      lineItems,
      charges: lineItems.map(item => ({
        type: item.type || 'OTHER',
        description: item.description,
        amount: item.amount,
        total: item.amount,
        account: item.account
      })),
      createdBy: req.user._id
    });

    await arEntry.populate('costCenter', 'name code');

    res.status(201).json({
      success: true,
      message: 'Invoice created successfully',
      data: arEntry
    });
  })
);

// @route   PUT /api/finance/accounts-receivable/:id
// @desc    Update invoice
// @access  Private (Finance and Admin)
router.put('/accounts-receivable/:id',
  authorize('super_admin', 'admin', 'finance_manager'),
  asyncHandler(async (req, res) => {
    const { doc: invoice } = await loadScopedDoc(AccountsReceivable, req, { _id: req.params.id }, 'Invoice');

    const paid = Math.max(Number(invoice.amountPaid || 0), Number(invoice.paidAmount || 0));
    if (paid > 0.009 || (Array.isArray(invoice.payments) && invoice.payments.length > 0)) {
      return res.status(400).json({
        success: false,
        message: 'Cannot edit invoice after payments have been recorded'
      });
    }
    if (invoice.status === 'cancelled') {
      return res.status(400).json({
        success: false,
        message: 'Cancelled invoices cannot be edited'
      });
    }

    const body = req.body || {};
    if (body.invoiceNumber != null) invoice.invoiceNumber = String(body.invoiceNumber).trim();
    if (body.invoiceDate) invoice.invoiceDate = body.invoiceDate;
    if (body.dueDate) invoice.dueDate = body.dueDate;
    if (body.paymentTerms) invoice.paymentTerms = body.paymentTerms;
    if (body.department != null) invoice.department = body.department;
    if (body.notes != null) invoice.notes = body.notes;
    if (body.costCenter) invoice.costCenter = body.costCenter;
    else if (body.costCenter === null || body.costCenter === '') {
      return res.status(400).json({ success: false, message: 'Cost center is required' });
    }

    if (body.customer && typeof body.customer === 'object') {
      const c = body.customer;
      if (!invoice.customer) invoice.customer = {};
      if (c.name != null) invoice.customer.name = String(c.name).trim();
      if (c.email !== undefined) invoice.customer.email = c.email ? String(c.email).trim() : '';
      if (c.phone !== undefined) invoice.customer.phone = c.phone ? String(c.phone).trim() : '';
      if (c.customerId !== undefined && c.customerId !== null && c.customerId !== '') {
        invoice.customer.customerId = c.customerId;
      }
      if (c.address !== undefined && c.address !== null) {
        if (typeof c.address === 'string') {
          invoice.customer.address = { street: String(c.address).trim() };
        } else if (typeof c.address === 'object') {
          invoice.customer.address = {
            street: c.address.street != null ? String(c.address.street).trim() : '',
            city: c.address.city != null ? String(c.address.city).trim() : '',
            state: c.address.state != null ? String(c.address.state).trim() : '',
            zipCode: c.address.zipCode != null ? String(c.address.zipCode).trim() : '',
            country: c.address.country != null ? String(c.address.country).trim() : ''
          };
        }
      }
      // Do not set address to undefined — that triggers CastError on Mixed/subdoc path
      invoice.markModified('customer');
    }

    if (Array.isArray(body.lineItems) && body.lineItems.length > 0) {
      invoice.lineItems = body.lineItems.map((item) => ({
        description: item.description || 'Line Item',
        quantity: Number(item.quantity) || 1,
        unitPrice: Number(item.unitPrice) || Number(item.amount) || 0,
        amount: Number(item.amount) || (Number(item.quantity || 1) * Number(item.unitPrice || 0)),
        account: item.account || null
      }));
    }

    if (body.totalAmount != null) {
      const total = Number(body.totalAmount);
      if (!(total >= 0)) {
        return res.status(400).json({ success: false, message: 'Total amount must be non-negative' });
      }
      invoice.totalAmount = total;
      invoice.subtotal = total;
    }

    invoice.updatedBy = req.user._id;
    await invoice.save();
    await invoice.populate([
      { path: 'costCenter', select: 'name code' },
      { path: 'companyId', select: 'name companyCode website contactInfo' }
    ]);

    res.json({
      success: true,
      message: 'Invoice updated successfully',
      data: invoice
    });
  })
);

// @route   GET /api/finance/accounts-receivable/:id
// @desc    Get invoice by ID
// @access  Private (Finance and Admin)
router.get('/accounts-receivable/:id',
  authorize('super_admin', 'admin', 'finance_manager'),
  asyncHandler(async (req, res) => {
    const { doc } = await loadScopedDoc(AccountsReceivable, req, { _id: req.params.id }, 'Invoice');
    await doc.populate([
      { path: 'costCenter', select: 'name code' },
      { path: 'companyId', select: 'name companyCode website contactInfo' },
      { path: 'lineItems.account', select: 'name accountNumber type category' }
    ]);
    const invoice = doc.toObject ? doc.toObject() : doc;

    res.json({
      success: true,
      data: {
        ...invoice,
        customerName: invoice.customer?.name || 'Unknown Customer',
        customerEmail: invoice.customer?.email || ''
      }
    });
  })
);

// @route   DELETE /api/finance/accounts-receivable/:id
// @desc    Delete an AR invoice (blocked if any receipts recorded)
// @access  Private (Finance and Admin)
router.delete('/accounts-receivable/:id',
  authorize('super_admin', 'admin', 'finance_manager'),
  asyncHandler(async (req, res) => {
    const { doc: invoice } = await loadScopedDoc(AccountsReceivable, req, { _id: req.params.id }, 'Invoice');

    const paid = Number(invoice.amountPaid || invoice.paidAmount || 0);
    const hasPayments = Array.isArray(invoice.payments) && invoice.payments.length > 0;
    const hasInstallmentPaid = (invoice.installments || []).some((i) => Number(i.paidAmount || 0) > 0 || i.status === 'paid');

    if (paid > 0 || hasPayments || hasInstallmentPaid) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete an invoice that has recorded payments or paid installments. Remove/delete receipt vouchers first.'
      });
    }

    // Clean up invoice journal entries + GL (AR posting on create)
    try {
      const jeQuery = {
        $or: [
          { referenceId: invoice._id },
          { reference: invoice.invoiceNumber },
          { description: { $regex: String(invoice.invoiceNumber || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } }
        ]
      };
      const jes = await JournalEntry.find(jeQuery).select('_id').lean();
      const jeIds = jes.map((j) => j._id);
      if (jeIds.length) {
        await GeneralLedger.deleteMany({ journalEntry: { $in: jeIds } });
        await JournalEntry.deleteMany({ _id: { $in: jeIds } });
      }
    } catch (jErr) {
      console.warn('Could not clean up journal entries for deleted AR invoice', jErr.message);
    }

    const invoiceNumber = invoice.invoiceNumber;
    await AccountsReceivable.findByIdAndDelete(invoice._id);

    res.json({
      success: true,
      message: `Invoice ${invoiceNumber} deleted successfully`
    });
  })
);

// @route   POST /api/finance/accounts-receivable/batch-payment
// @desc    Record one consolidated RV for multiple invoices / installments selected in one Receive Payment
// @access  Private (Finance and Admin)
router.post('/accounts-receivable/batch-payment',
  authorize('super_admin', 'admin', 'finance_manager'),
  [
    body('lines').isArray({ min: 1 }).withMessage('At least one payment line is required'),
    body('paymentMethod').isIn(['cash', 'check', 'credit_card', 'bank_transfer', 'ach', 'other']).withMessage('Valid payment method is required')
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });
    }

    try {
      const result = await FinanceHelper.recordARPaymentBatch({
        lines: req.body.lines,
        amount: req.body.amount,
        paymentMethod: req.body.paymentMethod,
        reference: req.body.reference,
        date: req.body.paymentDate,
        bankAccountId: req.body.bankAccountId || null,
        financeApprovalAuthorities: req.body.financeApprovalAuthorities || null,
        narration: req.body.narration || req.body.description || '',
        description: req.body.description || req.body.narration || '',
        costCenter: req.body.costCenter || null,
        payingCompanyId: req.body.payingCompanyId || null,
        createdBy: req.user._id
      });

      res.json({
        success: true,
        message: result.entryNumber
          ? `Payment recorded — one receipt voucher ${result.entryNumber} for ${result.lineCount} part(s)`
          : 'Payment recorded successfully',
        data: result
      });
    } catch (error) {
      res.status(400).json({ success: false, message: error.message || 'Failed to record batch payment' });
    }
  })
);

// @route   POST /api/finance/accounts-receivable/:id/payment
// @desc    Record receipt for invoice (with optional specific bank account)
// @access  Private (Finance and Admin)
router.post('/accounts-receivable/:id/payment',
  authorize('super_admin', 'admin', 'finance_manager'),
  [
    body('amount').isFloat({ min: 0 }).withMessage('Payment amount must be non-negative'),
    body('paymentMethod').isIn(['cash', 'check', 'credit_card', 'bank_transfer', 'ach', 'other']).withMessage('Valid payment method is required')
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });
    }

    try {
      const updatedInvoice = await FinanceHelper.recordARPayment(req.params.id, {
        amount: req.body.amount,
        paymentMethod: req.body.paymentMethod,
        reference: req.body.reference,
        date: req.body.paymentDate,
        bankAccountId: req.body.bankAccountId || null,
        financeApprovalAuthorities: req.body.financeApprovalAuthorities || null,
        installmentId: req.body.installmentId || null,
        narration: req.body.narration || req.body.description || '',
        createdBy: req.user._id
      });

      res.json({ success: true, message: 'Payment recorded successfully', data: updatedInvoice });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message || 'Failed to record payment' });
    }
  })
);

// @route   PUT /api/finance/accounts-receivable/:id/installments
// @desc    Set / replace installment schedule for an invoice (no journal entry)
// @access  Private (Finance and Admin)
router.put('/accounts-receivable/:id/installments',
  authorize('super_admin', 'admin', 'finance_manager'),
  asyncHandler(async (req, res) => {
    const { doc: invoice } = await loadScopedDoc(AccountsReceivable, req, { _id: req.params.id }, 'Invoice');
    if (invoice.status === 'cancelled') {
      return res.status(400).json({ success: false, message: 'Cannot set installments on a cancelled invoice' });
    }
    if (invoice.status === 'paid') {
      return res.status(400).json({ success: false, message: 'Invoice is already fully paid' });
    }

    const rows = Array.isArray(req.body.installments) ? req.body.installments : [];
    if (rows.length === 0) {
      return res.status(400).json({ success: false, message: 'Add at least one installment' });
    }

    const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
    const outstanding = round2((invoice.totalAmount || 0) - (invoice.amountPaid || invoice.paidAmount || 0));
    if (outstanding <= 0) {
      return res.status(400).json({ success: false, message: 'No outstanding balance to schedule' });
    }

    // Keep installments that already have receipts; only replace unpaid schedule rows
    const keptPaid = (invoice.installments || []).filter(
      (i) => i.status === 'paid' || (Number(i.paidAmount) || 0) > 0
    );
    const lockedRemaining = round2(
      keptPaid.reduce((s, i) => s + Math.max(0, (Number(i.amount) || 0) - (Number(i.paidAmount) || 0)), 0)
    );
    const needFromNew = round2(Math.max(0, outstanding - lockedRemaining));

    const newRows = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (row._id && keptPaid.some((k) => String(k._id) === String(row._id))) continue;
      if (row.status === 'paid' || (Number(row.paidAmount) || 0) > 0) continue;

      const amount = round2(row.amount);
      if (amount <= 0) {
        return res.status(400).json({ success: false, message: `Installment ${i + 1}: amount must be greater than zero` });
      }
      if (!row.dueDate) {
        return res.status(400).json({ success: false, message: `Installment ${i + 1}: due date is required` });
      }
      newRows.push({
        sequence: keptPaid.length + newRows.length + 1,
        amount,
        dueDate: new Date(row.dueDate),
        status: 'pending',
        paidAmount: 0,
        notes: row.notes || ''
      });
    }

    if (needFromNew > 0.01 && newRows.length === 0) {
      return res.status(400).json({ success: false, message: 'Add installment row(s) covering the outstanding balance' });
    }

    const newTotal = round2(newRows.reduce((s, r) => s + r.amount, 0));
    if (Math.abs(newTotal - needFromNew) > 0.05) {
      return res.status(400).json({
        success: false,
        message: `New installment total PKR ${newTotal.toFixed(2)} must equal remaining to schedule PKR ${needFromNew.toFixed(2)}`
      });
    }

    const merged = [
      ...keptPaid.map((k, idx) => {
        const obj = k.toObject ? k.toObject() : { ...k };
        obj.sequence = idx + 1;
        return obj;
      }),
      ...newRows.map((r, idx) => ({ ...r, sequence: keptPaid.length + idx + 1 }))
    ];

    invoice.installments = merged;
    await invoice.save();

    res.json({
      success: true,
      message: 'Installment schedule saved (no voucher created — vouchers post when each receipt is recorded)',
      data: invoice
    });
  })
);

// @route   PUT /api/finance/accounts-payable/:id
// @desc    Update bill
// @access  Private (Finance and Admin)
router.put('/accounts-payable/:id',
  authorize('super_admin', 'admin', 'finance_manager', 'general_manager', 'procurement_manager'),
  asyncHandler(async (req, res) => {
    const bill = await AccountsPayable.findById(req.params.id);
    if (!bill) {
      return res.status(404).json({
        success: false,
        message: 'Bill not found'
      });
    }

    const userId = req.user.id || req.user._id;
    const role = String(req.user.role || '');
    const isFinanceRole = ['super_admin', 'admin', 'finance_manager', 'general_manager'].includes(role);
    const isInitiator = String(bill.createdBy || '') === String(userId);

    // Returned from Finance: initiator (or finance) may edit; approval chain untouched
    if (bill.status === 'Returned from Finance') {
      if (!isInitiator && !isFinanceRole) {
        return res.status(403).json({
          success: false,
          message: 'Only the bill initiator can edit a bill returned from Finance'
        });
      }
    } else if (!isFinanceRole) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to edit this bill'
      });
    }

    const paid = Number(bill.amountPaid ?? bill.paidAmount ?? 0) || 0;
    const advanceApplied = Number(bill.advanceApplied || 0) || 0;
    const settlementPending = Number(
      bill.settlementPending ?? ((bill.advancePending || 0) + (bill.paymentPending || 0))
    ) || 0;
    const nonEditableStatus = ['paid', 'partial', 'cancelled', 'Pending Audit', 'Forwarded to Audit Director'].includes(bill.status);
    const hasSettlement = paid + advanceApplied > 0 || settlementPending > 0;
    if (nonEditableStatus || hasSettlement) {
      return res.status(400).json({
        success: false,
        message: 'Cannot edit vendor bill after payment has been recorded or is pending approval'
      });
    }

    // Never allow client to wipe department approval when correcting a returned bill
    if (bill.status === 'Returned from Finance' && req.body) {
      delete req.body.approvalStatus;
      delete req.body.approvalChain;
      delete req.body.status;
    }

    Object.assign(bill, req.body);
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'companyId')) {
      bill.companyId = req.body.companyId || null;
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'company')) {
      bill.company = req.body.company || '';
    }
    await bill.save();

    // If bill line items or total amount updated, sync linked posted journal entry & GL
    try {
      const linkedJournal = await JournalEntry.findOne({
        $or: [
          { referenceId: bill._id },
          { reference: bill.billNumber }
        ],
        status: 'posted'
      });

      if (linkedJournal) {
        const nextCompanyId = co(bill) || linkedJournal.companyId;
        if (nextCompanyId && String(linkedJournal.companyId || '') !== String(nextCompanyId)) {
          linkedJournal.companyId = nextCompanyId;
          if (bill.company) linkedJournal.customCompany = bill.company;
          await linkedJournal.save();
        }
      }

      if (linkedJournal && Array.isArray(bill.lineItems) && bill.lineItems.length > 0) {
        const companyId = co(bill) || linkedJournal.companyId;
        const A = acct(companyId);
        const apAccount = await A.resolve(FinanceHelper.ACCOUNTS.PAYABLE);

        // Build new debit lines matching updated AP line items
        const newLines = [];
        for (const li of bill.lineItems) {
          let lineAcc = li.account ? await A.map(li.account) : null;
          if (!lineAcc && li.expenseAccount) lineAcc = await A.map(li.expenseAccount);
          if (!lineAcc) lineAcc = await A.resolve(FinanceHelper.ACCOUNTS.UTILITIES || '6200');

          newLines.push({
            account: lineAcc._id,
            description: (li.description || `Expense — ${bill.billNumber}`).slice(0, 200),
            debit: Math.round((Number(li.quantity || 1) * Number(li.unitPrice || 0)) * 100) / 100,
            department: bill.department || linkedJournal.department
          });
        }

        // Add credit AP line
        const totalAmount = Math.round(Number(bill.totalAmount || 0) * 100) / 100;
        const debitSum = newLines.reduce((s, l) => s + l.debit, 0);
        if (Math.abs(debitSum - totalAmount) > 0.01 && newLines.length > 0) {
          newLines[newLines.length - 1].debit += (totalAmount - debitSum);
          newLines[newLines.length - 1].debit = Math.round(newLines[newLines.length - 1].debit * 100) / 100;
        }

        newLines.push({
          account: apAccount?._id || linkedJournal.lines.find(l => l.credit > 0)?.account,
          description: `Payable to ${bill.vendor?.name || 'Vendor'}`,
          credit: totalAmount,
          department: bill.department || linkedJournal.department
        });

        // Revert old account balance increments
        for (const line of linkedJournal.lines) {
          await Account.findByIdAndUpdate(line.account, {
            $inc: { balance: -(line.debit - line.credit) }
          });
        }

        // Apply new lines & re-save to trigger new balance increments
        linkedJournal.lines = newLines;
        linkedJournal.totalDebits = totalAmount;
        linkedJournal.totalCredits = totalAmount;
        await linkedJournal.save();

        // Refresh GL entries for this journal
        await GeneralLedger.deleteMany({ journalEntry: linkedJournal._id });
        await FinanceHelper.postToGeneralLedger(linkedJournal._id);
      }
    } catch (syncErr) {
      console.warn('⚠️ Journal sync warning on AP update:', syncErr.message);
    }

    res.json({
      success: true,
      message: 'Bill updated successfully',
      data: bill
    });
  })
);

// @route   GET /api/finance/accounts-payable/pos-for-billing
// @desc    List POs with status "Sent to Finance" for billing
// @access  Private (Finance and Admin)
router.get('/accounts-payable/pos-for-billing',
  authorize('super_admin', 'admin', 'finance_manager'),
  asyncHandler(async (req, res) => {
    const pos = await PurchaseOrder.find({ status: 'Sent to Finance' })
      .populate('vendor', 'name email phone')
      .populate('indent', 'indentNumber title department requestedBy')
      .sort({ updatedAt: -1 })
      .lean();
    res.json({ success: true, data: pos });
  })
);

// @route   POST /api/finance/accounts-payable/create-from-po
// @desc    Create bill from purchase order (Indent, Quotations, CS, PO, GRN linked)
// @access  Private (Finance and Admin)
router.post('/accounts-payable/create-from-po',
  authorize('super_admin', 'admin', 'finance_manager'),
  [
    body('purchaseOrderId').trim().notEmpty().withMessage('Purchase order ID is required')
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });
    }
    const po = await PurchaseOrder.findById(req.body.purchaseOrderId)
      .populate('vendor', 'name email phone')
      .populate('indent', 'indentNumber title');
    if (!po) return res.status(404).json({ success: false, message: 'Purchase order not found' });
    if (po.status !== 'Sent to Finance') {
      return res.status(400).json({
        success: false,
        message: 'Only purchase orders with status "Sent to Finance" can be billed'
      });
    }
    const billNumber = req.body.billNumber || `BILL-PO-${po.orderNumber}-${Date.now().toString(36).toUpperCase()}`;
    const billDate = req.body.billDate || new Date();
    const dueDate = req.body.dueDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const lineItems = (po.items || []).map(it => ({
      description: it.description || 'Item',
      quantity: it.quantity || 1,
      unitPrice: it.unitPrice || 0
    }));
    const company = await resolveCompanyForFinanceRoute(req);
    const apEntry = await FinanceHelper.createAPFromBill({
      companyId: company._id,
      vendorName: po.vendor?.name || 'Unknown',
      vendorEmail: po.vendor?.email || '',
      vendorId: po.vendor?._id || po.vendor,
      billNumber,
      billDate,
      dueDate,
      amount: po.totalAmount || 0,
      department: 'procurement',
      module: 'procurement',
      referenceId: po._id,
      referenceType: 'purchase_order',
      lineItems: lineItems.length > 0 ? lineItems : undefined,
      createdBy: req.user._id
    });
    res.status(201).json({
      success: true,
      message: 'Bill created from purchase order',
      data: apEntry
    });
  })
);

// @route   GET /api/finance/accounts-payable/aging  ← must come BEFORE /:id
// @desc    Get accounts payable aging report
// @access  Private (Finance and Admin)
router.get('/accounts-payable/aging',
  authorize('super_admin', 'admin', 'finance_manager'),
  asyncHandler(async (req, res) => {
    const { q } = await financeScope(req);
    const agingReport = await AccountsPayable.getAgingReport(q({}));
    res.json({ success: true, data: agingReport });
  })
);

// @route   GET /api/finance/accounts-payable/vendor-advances
// @desc    Get vendor advance history (partial advances + applied amounts) per vendor
// @access  Private (Finance and Admin)
// IMPORTANT: Must be registered BEFORE /accounts-payable/:id
// because Express will otherwise treat `vendor-advances` as the `:id` parameter.
router.get('/accounts-payable/vendor-advances',
  authorize('super_admin', 'admin', 'finance_manager'),
  asyncHandler(async (req, res) => {
    const {
      vendorId,
      page = 1,
      limit = 50,
      status,
      search
    } = req.query;

    const { q } = await financeScope(req);
    const filters = q({});
    if (vendorId) filters['vendor.vendorId'] = vendorId;
    if (status) filters.status = status;

    if (search) {
      filters.$or = [
        { reference: { $regex: search, $options: 'i' } },
        { 'vendor.name': { $regex: search, $options: 'i' } },
        { 'vendor.email': { $regex: search, $options: 'i' } }
      ];
    }

    const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);

    const [rows, totalCount] = await Promise.all([
      VendorAdvance.find(filters)
        .sort({ paymentDate: -1, createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit, 10))
        .lean(),
      VendorAdvance.countDocuments(filters)
    ]);

    const poIds = [
      ...new Set(
        rows
          .filter((a) => {
            if (!a.referenceId) return false;
            const rt = a.referenceType;
            return rt === 'purchase_order' || rt === 'advance' || rt == null || rt === '' || typeof rt === 'undefined';
          })
          .map((a) => String(a.referenceId))
      )
    ];
    const poMap = {};
    if (poIds.length > 0) {
      const poDocs = await PurchaseOrder.find({ _id: { $in: poIds } }).select('orderNumber').lean();
      poDocs.forEach((p) => { poMap[String(p._id)] = p.orderNumber; });
    }

    const jeIds = [
      ...new Set(
        rows
          .flatMap((r) => [r.journalEntryId, r.payingJournalEntryId])
          .filter(Boolean)
          .map((id) => String(id))
      )
    ];
    const jeSignedById = {};
    if (jeIds.length > 0) {
      const jes = await JournalEntry.find({ _id: { $in: jeIds } })
        .select('signedDocumentStatus signedDocumentAt companyId entryNumber voucherSeries')
        .populate('companyId', 'name companyCode')
        .lean();
      jes.forEach((je) => {
        jeSignedById[String(je._id)] = je;
      });
    }

    const companyIds = [
      ...new Set(
        rows
          .flatMap((r) => [r.companyId, r.payingCompanyId])
          .filter(Boolean)
          .map((id) => String(id))
      )
    ];
    const companyById = {};
    if (companyIds.length > 0) {
      const PlacementCompany = require('../models/hr/Company');
      const cos = await PlacementCompany.find({ _id: { $in: companyIds } }).select('name companyCode').lean();
      cos.forEach((c) => { companyById[String(c._id)] = c; });
    }

    const bankIds = [...new Set(rows.map((r) => r.bankAccountId).filter(Boolean).map((id) => String(id)))];
    const bankById = {};
    if (bankIds.length > 0) {
      const bankRows = await Account.find({ _id: { $in: bankIds } }).select('name accountNumber companyId').lean();
      bankRows.forEach((b) => { bankById[String(b._id)] = b; });
    }

    const advances = rows.map((a) => {
      const amount = Number(a.amount || 0);
      const applied = Number(a.appliedAmount || 0);
      const remainingAmount = Math.round((amount - applied) * 100) / 100;

      const allocations = Array.isArray(a.allocations)
        ? a.allocations
            .filter((al) => al && (al.billNumber || al.billId))
            .map((al) => ({
              billId: al.billId || null,
              billNumber: al.billNumber || '',
              amount: Math.round((Number(al.amount) || 0) * 100) / 100,
              appliedAt: al.appliedAt || null
            }))
            .sort((x, y) => new Date(x.appliedAt || 0) - new Date(y.appliedAt || 0))
        : [];

      const je = a.journalEntryId ? jeSignedById[String(a.journalEntryId)] : null;
      const payingJe = a.payingJournalEntryId ? jeSignedById[String(a.payingJournalEntryId)] : null;
      const bankAcc = a.bankAccountId ? bankById[String(a.bankAccountId)] : null;
      const companyDoc = a.companyId ? companyById[String(a.companyId)] : null;
      const payingCompanyDoc = a.payingCompanyId ? companyById[String(a.payingCompanyId)] : null;
      return {
        _id: a._id,
        vendor: a.vendor,
        amount,
        appliedAmount: applied,
        remainingAmount,
        paymentMethod: a.paymentMethod,
        bankAccountId: a.bankAccountId || null,
        bankAccount: bankAcc
          ? { _id: bankAcc._id, name: bankAcc.name, accountNumber: bankAcc.accountNumber }
          : null,
        reference: a.reference,
        chequeNumber: a.chequeNumber || null,
        paymentDate: a.paymentDate,
        status: a.status,
        referenceType: a.referenceType,
        referenceId: a.referenceId,
        linkedPoNumber: a.referenceId ? (poMap[String(a.referenceId)] || null) : null,
        companyId: a.companyId || null,
        company: companyDoc ? { _id: companyDoc._id, name: companyDoc.name, companyCode: companyDoc.companyCode } : null,
        payingCompanyId: a.payingCompanyId || null,
        payingCompany: payingCompanyDoc
          ? { _id: payingCompanyDoc._id, name: payingCompanyDoc.name, companyCode: payingCompanyDoc.companyCode }
          : null,
        journalEntryId: a.journalEntryId || null,
        payingJournalEntryId: a.payingJournalEntryId || null,
        voucherWorkflowStatus: a.voucherWorkflowStatus || 'immediate',
        voucherSignedDocumentStatus: (payingJe || je)?.signedDocumentStatus || null,
        voucherSignedDocumentAt: (payingJe || je)?.signedDocumentAt || null,
        allocations
      };
    });

    res.json({
      success: true,
      data: {
        advances,
        pagination: {
          currentPage: parseInt(page, 10),
          limit: parseInt(limit, 10),
          totalCount,
          totalPages: Math.ceil(totalCount / parseInt(limit, 10))
        }
      }
    });
  })
);

// @route   GET /api/finance/accounts-payable/vendor-advance-po-queue
// @desc    POs in Pending Finance with advance payment terms that still need vendor advance recorded (or balance due)
// @access  Private (Finance and Admin)
router.get('/accounts-payable/vendor-advance-po-queue',
  authorize('super_admin', 'admin', 'finance_manager'),
  asyncHandler(async (req, res) => {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 250, 1), 500);

    const { q } = await financeScope(req);

    // Prefetch Pending Finance POs that mention advance; exact full-advance gate applied below
    const pos = await PurchaseOrder.find(q({
      status: 'Pending Finance',
      paymentTerms: { $regex: /advance/i }
    }))
      .populate('vendor', 'name email phone')
      .populate('companyId', 'name companyCode')
      .sort({ updatedAt: -1 })
      .lean();

    const advancePos = pos.filter((po) => isFullAdvancePaymentTerm(po.paymentTerms));
    const poIds = advancePos.map((p) => p._id);
    const advances = poIds.length
      ? await VendorAdvance.find(q({
        referenceId: { $in: poIds },
        $or: [
          { referenceType: 'purchase_order' },
          { referenceType: 'advance' },
          { referenceType: null },
          { referenceType: '' },
          { referenceType: { $exists: false } }
        ]
      }))
        .select('referenceId amount voucherWorkflowStatus journalEntryId')
        .lean()
      : [];

    const jeSignedByJournalId = await buildJournalEntrySignedMapForVendorAdvances(advances);

    const pendingVoucherByPo = new Set(
      advances
        .filter((a) => a.voucherWorkflowStatus === 'pending_authority' && a.journalEntryId)
        .map((a) => String(a.referenceId))
    );

    const sumByPo = {};
    for (const a of advances) {
      if (!vendorAdvanceAmountCountsForPo(a, jeSignedByJournalId)) continue;
      const id = String(a.referenceId);
      sumByPo[id] = (sumByPo[id] || 0) + Math.round((Number(a.amount) || 0) * 100) / 100;
    }

    const items = advancePos
      .map((po) => {
        const id = String(po._id);
        const total = Math.round((Number(po.totalAmount) || 0) * 100) / 100;
        const recorded = sumByPo[id] || 0;
        const remaining = Math.round((total - recorded) * 100) / 100;
        const needsPayment = remaining > 0.009;
        const hasPendingVoucherApproval = pendingVoucherByPo.has(id);
        const ven = po.vendor || {};
        const comp = po.companyId || {};
        return {
          _id: po._id,
          orderNumber: po.orderNumber,
          paymentTerms: po.paymentTerms,
          company: comp.name || po.company || '—',
          companyId: comp._id || po.companyId || null,
          totalAmount: total,
          advanceRecordedAmount: recorded,
          remainingAdvanceDue: Math.max(0, remaining),
          needsPayment,
          hasPendingVoucherApproval,
          vendor: {
            _id: ven._id || po.vendor,
            name: ven.name || '',
            email: ven.email || ''
          },
          updatedAt: po.updatedAt
        };
      })
      .filter((row) => row.needsPayment);

    const totalCount = items.length;
    const skip = (page - 1) * limit;
    const pagedItems = items.slice(skip, skip + limit);

    res.json({
      success: true,
      data: {
        items: pagedItems,
        count: pagedItems.length,
        pagination: {
          currentPage: page,
          limit,
          totalCount,
          totalPages: Math.ceil(totalCount / limit) || 0
        }
      }
    });
  })
);

// @route   GET /api/finance/vendor-advances/by-journal-entry/:journalEntryId
// @desc    Vendor advance linked to a journal entry (for voucher detail / authority UI)
// @access  Private (Finance and Admin)
router.get('/vendor-advances/by-journal-entry/:journalEntryId',
  authorize('super_admin', 'admin', 'finance_manager'),
  asyncHandler(async (req, res) => {
    const jeId = req.params.journalEntryId;
    const doc = await populateVendorAdvanceDoc({
      $or: [{ journalEntryId: jeId }, { payingJournalEntryId: jeId }]
    });
    if (!doc) {
      return res.status(404).json({ success: false, message: 'Vendor advance not found for this voucher' });
    }
    res.json({ success: true, data: doc.toObject ? doc.toObject() : doc });
  })
);

// @route   GET /api/finance/vendor-advances/po/:purchaseOrderId/pending-voucher
// @desc    Whether this PO already has a vendor advance waiting for voucher signatures (blocks a second recording)
// @access  Private (Finance and Admin)
router.get('/vendor-advances/po/:purchaseOrderId/pending-voucher',
  authorize('super_admin', 'admin', 'finance_manager'),
  asyncHandler(async (req, res) => {
    // Broken rows (pending but no journal) must not block new payments — clear them
    await VendorAdvance.deleteMany({
      ...vendorAdvancesLinkedToPurchaseOrderFilter(req.params.purchaseOrderId),
      voucherWorkflowStatus: 'pending_authority',
      $or: [{ journalEntryId: null }, { journalEntryId: { $exists: false } }]
    });

    const pending = await VendorAdvance.findOne({
      ...vendorAdvancesLinkedToPurchaseOrderFilter(req.params.purchaseOrderId),
      voucherWorkflowStatus: 'pending_authority',
      journalEntryId: { $ne: null }
    })
      .select('_id reference journalEntryId')
      .lean();
    res.json({
      success: true,
      data: {
        hasPending: Boolean(pending),
        advanceId: pending?._id || null,
        journalEntryId: pending?.journalEntryId || null
      }
    });
  })
);

// @route   PUT /api/finance/vendor-advances/:id/finance-approve
// @desc    Record finance authority approval; posts voucher to GL when all authorities approve
// @access  Private (Finance and Admin)
router.put('/vendor-advances/:id/finance-approve',
  authorize('super_admin', 'admin', 'finance_manager'),
  asyncHandler(async (req, res) => {
    const advance = await VendorAdvance.findById(req.params.id);
    if (!advance) return res.status(404).json({ success: false, message: 'Vendor advance not found' });
    if (advance.voucherWorkflowStatus !== 'pending_authority') {
      return res.status(400).json({
        success: false,
        message: 'Voucher authority approval only applies when the advance is pending signatures'
      });
    }
    const slots = getRequiredFinanceAuthoritySlots(advance);
    if (!slots.length) {
      return res.status(400).json({ success: false, message: 'Finance approval authorities are not configured on this advance' });
    }
    const matchedSlots = matchUserToFinanceSlots(slots, req.user);
    if (!matchedSlots.length) {
      return res.status(403).json({ success: false, message: 'Your user is not assigned as a finance authority for this voucher' });
    }
    const approvals = Array.isArray(advance.financeAuthorityApprovals) ? [...advance.financeAuthorityApprovals] : [];
    const approvedKeys = new Set(
      approvals
        .filter((a) => String(a?.decision || 'approved').trim() !== 'rejected')
        .map((a) => String(a?.authorityKey || '').trim())
        .filter(Boolean)
    );
    const pendingMatchedSlots = matchedSlots.filter((slot) => !approvedKeys.has(slot.key));
    if (!pendingMatchedSlots.length) {
      return res.status(400).json({ success: false, message: 'You have already approved your assigned finance authority slot' });
    }
    const now = new Date();
    pendingMatchedSlots.forEach((slot) => {
      approvals.push({
        authorityKey: slot.key,
        authorityLabel: slot.label,
        approver: req.user._id,
        decision: 'approved',
        approvedAt: now,
        comments: req.body?.comments || ''
      });
    });
    advance.financeAuthorityApprovals = approvals;
    await advance.save();

    const requiredKeys = new Set(slots.map((s) => s.key));
    const approvedNow = new Set(
      advance.financeAuthorityApprovals
        .filter((a) => String(a?.decision || 'approved').trim() !== 'rejected')
        .map((a) => String(a?.authorityKey || '').trim())
        .filter(Boolean)
    );
    const remaining = [...requiredKeys].filter((k) => !approvedNow.has(k)).length;

    if (remaining === 0) {
      const postLinkedJe = async (jeId, label) => {
        if (!jeId) return;
        const je = await JournalEntry.findById(jeId);
      if (!je) {
          const err = new Error(`Linked ${label} journal entry missing`);
          err.statusCode = 500;
          throw err;
      }
      if (je.status === 'draft') {
        await je.post(req.user._id);
        const glCount = await GeneralLedger.countDocuments({ journalEntry: je._id });
        if (glCount === 0) {
          await FinanceHelper.postToGeneralLedger(je._id);
        }
      } else if (je.status !== 'posted') {
          const err = new Error(`${label} journal entry cannot be finalized from status: ${je.status}`);
          err.statusCode = 400;
          throw err;
        }
      };

      try {
        await postLinkedJe(advance.journalEntryId, 'vendor advance');
        await postLinkedJe(advance.payingJournalEntryId, 'paying-company');
      } catch (postErr) {
        return res.status(postErr.statusCode || 500).json({
          success: false,
          message: postErr.message || 'Failed to post voucher(s)'
        });
      }
      advance.voucherWorkflowStatus = 'fully_approved';
      await advance.save();
    }

    const fresh = await populateVendorAdvanceDoc({ _id: advance._id });
    const message = remaining === 0
      ? (advance.payingJournalEntryId
        ? 'All finance authorities approved. Original-company and paying-company vouchers posted to the ledger.'
        : 'All finance authorities approved. Voucher posted to the ledger.')
      : `Finance authority recorded. ${remaining} approval(s) remaining.`;
    res.json({ success: true, message, data: fresh.toObject ? fresh.toObject() : fresh });
  })
);

// @route   PUT /api/finance/vendor-advances/:id/finance-reject
// @desc    Reject voucher authority chain (draft JE cancelled)
// @access  Private (Finance and Admin)
router.put('/vendor-advances/:id/finance-reject',
  authorize('super_admin', 'admin', 'finance_manager'),
  asyncHandler(async (req, res) => {
    const advance = await VendorAdvance.findById(req.params.id);
    if (!advance) return res.status(404).json({ success: false, message: 'Vendor advance not found' });
    if (advance.voucherWorkflowStatus !== 'pending_authority') {
      return res.status(400).json({ success: false, message: 'Rejection only applies while voucher is pending signatures' });
    }
    const slots = getRequiredFinanceAuthoritySlots(advance);
    if (!slots.length) {
      return res.status(400).json({ success: false, message: 'Finance approval authorities are not configured on this advance' });
    }
    const matchedSlots = matchUserToFinanceSlots(slots, req.user);
    if (!matchedSlots.length) {
      return res.status(403).json({ success: false, message: 'Your user is not assigned as a finance authority for this voucher' });
    }
    const approvals = Array.isArray(advance.financeAuthorityApprovals) ? [...advance.financeAuthorityApprovals] : [];
    const decidedKeys = new Set(approvals.map((a) => String(a?.authorityKey || '').trim()).filter(Boolean));
    const pendingMatchedSlots = matchedSlots.filter((slot) => !decidedKeys.has(slot.key));
    if (!pendingMatchedSlots.length) {
      return res.status(400).json({ success: false, message: 'You have already acted on your assigned finance authority slot' });
    }
    const now = new Date();
    pendingMatchedSlots.forEach((slot) => {
      approvals.push({
        authorityKey: slot.key,
        authorityLabel: slot.label,
        approver: req.user._id,
        decision: 'rejected',
        approvedAt: now,
        comments: req.body?.comments || req.body?.rejectionComments || ''
      });
    });
    advance.financeAuthorityApprovals = approvals;
    advance.voucherWorkflowStatus = 'rejected';
    await advance.save();

    const cancelDraft = async (jeId) => {
      if (!jeId) return;
      const je = await JournalEntry.findById(jeId);
    if (je && je.status === 'draft') {
      je.status = 'cancelled';
      await je.save();
    }
    };
    await cancelDraft(advance.journalEntryId);
    await cancelDraft(advance.payingJournalEntryId);

    const fresh = await populateVendorAdvanceDoc({ _id: advance._id });
    res.json({
      success: true,
      message: 'Finance authority rejection recorded. Draft voucher(s) cancelled.',
      data: fresh.toObject ? fresh.toObject() : fresh
    });
  })
);

const ApPaymentApplication = require('../models/finance/ApPaymentApplication');
const ApPaymentHelper = require('../utils/apPaymentApplication');

const populateApPaymentApplication = (query) => ApPaymentHelper.populateApplication(query);

// @route   GET /api/finance/ap-payment-applications/by-journal-entry/:journalEntryId
router.get('/ap-payment-applications/by-journal-entry/:journalEntryId',
  authorize('super_admin', 'admin', 'finance_manager'),
  asyncHandler(async (req, res) => {
    const doc = await populateApPaymentApplication({
      $or: [
        { journalEntryId: req.params.journalEntryId },
        { payingJournalEntryId: req.params.journalEntryId }
      ]
    });
    if (!doc) {
      return res.status(404).json({ success: false, message: 'AP settlement not found for this voucher' });
    }
    res.json({ success: true, data: doc.toObject ? doc.toObject() : doc });
  })
);

// @route   PUT /api/finance/ap-payment-applications/:id/finance-approve
router.put('/ap-payment-applications/:id/finance-approve',
  authorize('super_admin', 'admin', 'finance_manager'),
  asyncHandler(async (req, res) => {
    const app = await ApPaymentApplication.findById(req.params.id);
    if (!app) return res.status(404).json({ success: false, message: 'AP settlement not found' });
    const { remaining, finalized } = await ApPaymentHelper.recordAuthorityApproval(
      app,
      req.user,
      req.body?.comments || ''
    );
    const fresh = await populateApPaymentApplication({ _id: app._id });
    const message = finalized
      ? (app.payingJournalEntryId
        ? 'All finance authorities approved. Both vouchers posted (original company + paying company) and bill settlement finalized.'
        : 'All finance authorities approved. Voucher posted and bill settlement finalized.')
      : `Finance authority recorded. ${remaining} approval(s) remaining.`;
    res.json({ success: true, message, data: fresh?.toObject ? fresh.toObject() : fresh });
  })
);

// @route   PUT /api/finance/ap-payment-applications/:id/finance-reject
router.put('/ap-payment-applications/:id/finance-reject',
  authorize('super_admin', 'admin', 'finance_manager'),
  asyncHandler(async (req, res) => {
    const app = await ApPaymentApplication.findById(req.params.id);
    if (!app) return res.status(404).json({ success: false, message: 'AP settlement not found' });
    await ApPaymentHelper.recordAuthorityRejection(app, req.user, req.body?.comments || req.body?.rejectionComments || '');
    const fresh = await populateApPaymentApplication({ _id: app._id });
    res.json({
      success: true,
      message: 'Finance authority rejection recorded. Draft voucher cancelled and bill pending amount released.',
      data: fresh?.toObject ? fresh.toObject() : fresh
    });
  })
);

// @route   GET /api/finance/accounts-payable/payee-cash-approvals
// @desc    Cash approvals linked to bill payment payee (employee or vendor)
// IMPORTANT: Must be registered BEFORE /accounts-payable/:id
router.get('/accounts-payable/payee-cash-approvals',
  authorize('super_admin', 'admin', 'finance_manager'),
  asyncHandler(async (req, res) => {
    const employeeId = String(req.query.employeeId || '').trim();
    const employeeCode = String(req.query.employeeCode || '').trim();
    const vendorId = String(req.query.vendorId || '').trim();
    if (!employeeId && !employeeCode && !vendorId) {
      return res.status(400).json({ success: false, message: 'employeeId, employeeCode, or vendorId is required' });
    }
    if ((employeeId || employeeCode) && vendorId) {
      return res.status(400).json({ success: false, message: 'Provide employee or vendor, not both' });
    }

    let filter;
    if (vendorId) {
      filter = { status: { $nin: ['Draft', 'Cancelled', 'Rejected'] }, vendor: vendorId };
    } else {
      const employee = await resolveEmployeeForFinanceQuery(employeeId || employeeCode);
      if (!employee) {
        return res.json({ success: true, data: [] });
      }
      filter = await buildCashApprovalEmployeeFilter(employee);
      if (!filter) {
        return res.json({ success: true, data: [] });
      }
    }

    const company = await resolveCompanyForFinanceRoute(req);
    const cas = await CashApproval.find({ ...filter, ...companyQuery({}, company) })
      .select(
        'caNumber status totalAmount advanceAmount apAdvanceApplied advanceIssuedAt approvalDate expectedPurchaseDate originatingModule advanceToName advanceGlAccountNumber advanceToEmployee'
      )
      .populate('vendor', 'name')
      .sort({ approvalDate: -1, createdAt: -1 })
      .limit(100)
      .lean();

    const rows = await Promise.all(cas.map(async (ca) => {
      const advanceAmount = Math.round((Number(ca.advanceAmount) || Number(ca.totalAmount) || 0) * 100) / 100;
      const applied = Math.round((Number(ca.apAdvanceApplied) || 0) * 100) / 100;
      const issued = Boolean(ca.advanceIssuedAt);
      const open = issued ? await ApPaymentHelper.getCaOpenForAp(ca) : null;

      return {
        cashApprovalId: String(ca._id),
        caNumber: ca.caNumber,
        status: ca.status,
        approvalDate: ca.approvalDate,
        advanceIssuedAt: ca.advanceIssuedAt,
        totalAmount: Math.round((Number(ca.totalAmount) || 0) * 100) / 100,
        advanceAmount,
        applied: issued ? applied : null,
        open,
        advanceGlAccountNumber: ca.advanceGlAccountNumber || null,
        originatingModule: ca.originatingModule || 'procurement',
        payeeName: vendorId
          ? (ca.vendor?.name || null)
          : (ca.advanceToName || null)
      };
    }));

    res.json({ success: true, data: rows });
  })
);

// @route   GET /api/finance/accounts-payable/vendor-advance-balance
// @desc    Get open unapplied Vendor Advances for a vendor
router.get('/accounts-payable/vendor-advance-balance',
  authorize('super_admin', 'admin', 'finance_manager'),
  asyncHandler(async (req, res) => {
    const vendorId = String(req.query.vendorId || '').trim();
    const vendorName = String(req.query.vendorName || '').trim();
    if (!vendorId && !vendorName) {
      return res.status(400).json({ success: false, message: 'vendorId or vendorName is required' });
    }

    const company = await resolveCompanyForFinanceRoute(req);
    const filter = {
      voucherWorkflowStatus: { $in: ['immediate', 'fully_approved'] },
      ...companyQuery({}, company)
    };

    if (vendorId) {
      filter['vendor.vendorId'] = vendorId;
    } else {
      filter['vendor.name'] = { $regex: `^${vendorName}$`, $options: 'i' };
    }

    const rawAdvances = await VendorAdvance.find(filter)
      .select('reference amount appliedAmount paymentDate paymentMethod bankAccountId vendor')
      .sort({ paymentDate: 1 })
      .lean();

    const advances = rawAdvances.map((adv) => {
      const amount = Math.round((Number(adv.amount) || 0) * 100) / 100;
      const applied = Math.round((Number(adv.appliedAmount) || 0) * 100) / 100;
      const open = Math.round(Math.max(0, amount - applied) * 100) / 100;
      return {
        vendorAdvanceId: String(adv._id),
        reference: adv.reference,
        amount,
        applied,
        open,
        paymentDate: adv.paymentDate,
        paymentMethod: adv.paymentMethod,
        vendor: adv.vendor
      };
    }).filter((r) => r.open > 0);

    const totalOpen = Math.round(advances.reduce((s, r) => s + r.open, 0) * 100) / 100;
    res.json({ success: true, data: { totalOpen, advances } });
  })
);

// @route   GET /api/finance/accounts-payable/employee-advance-balance
router.get('/accounts-payable/employee-advance-balance',
  authorize('super_admin', 'admin', 'finance_manager'),
  asyncHandler(async (req, res) => {
    const employeeId = String(req.query.employeeId || '').trim();
    if (!employeeId) {
      return res.status(400).json({ success: false, message: 'employeeId is required' });
    }
    const employee = await resolveEmployeeForFinanceQuery(employeeId);
    const employeeFilter = employee ? await buildCashApprovalEmployeeFilter(employee) : null;
    const cas = await CashApproval.find({
      ...(employeeFilter || { advanceToEmployee: employeeId }),
      advanceIssuedAt: { $ne: null }
    })
      .select('caNumber advanceAmount apAdvanceApplied totalAmount advanceIssuedAt status')
      .sort({ advanceIssuedAt: 1 })
      .lean();

    const advances = (
      await Promise.all(
        cas.map(async (ca) => {
          const advanced = Math.round((Number(ca.advanceAmount) || Number(ca.totalAmount) || 0) * 100) / 100;
          const applied = Math.round((Number(ca.apAdvanceApplied) || 0) * 100) / 100;
          const open = await ApPaymentHelper.getCaOpenForAp(ca);
          return {
            cashApprovalId: String(ca._id),
            caNumber: ca.caNumber,
            advanced,
            applied,
            open,
            status: ca.status
          };
        })
      )
    ).filter((r) => r.open > 0);

    const totalOpen = Math.round(advances.reduce((s, r) => s + r.open, 0) * 100) / 100;
    res.json({ success: true, data: { totalOpen, advances } });
  })
);

// @route   POST /api/finance/accounts-payable/apply-employee-advance-batch
// @desc    Apply cash approval advance(s) to bill(s) — totals must match (Taj deposit-style)
router.post('/accounts-payable/apply-employee-advance-batch',
  authorize('super_admin', 'admin', 'finance_manager'),
  [
    body('employeeId').isMongoId().withMessage('Valid employeeId is required'),
    body('cashApprovalUsages').isArray({ min: 1 }).withMessage('cashApprovalUsages is required'),
    body('cashApprovalUsages.*.cashApprovalId').isMongoId(),
    body('cashApprovalUsages.*.amount').isFloat({ min: 0.01 }),
    body('billAllocations').isArray({ min: 1 }).withMessage('billAllocations is required'),
    body('billAllocations.*.billId').isMongoId(),
    body('billAllocations.*.amount').isFloat({ min: 0.01 })
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });
    }

    const result = await FinanceHelper.applyEmployeeAdvanceBatch(
      req.body.employeeId,
      req.body.cashApprovalUsages,
      req.body.billAllocations,
      req.user._id,
      { financeApprovalAuthorities: req.body.financeApprovalAuthorities }
    );

    const pending = Number(result.pending || 0);
    const message = pending > 0
      ? `Settlement submitted: PKR ${pending.toLocaleString('en-PK')} pending finance voucher approval on ${(result.adjustments || []).length} voucher(s).`
      : `Advance applied to bill(s): PKR ${Number(result.applied || 0).toLocaleString('en-PK')}`;

    res.json({ success: true, message, data: result });
  })
);

// @route   GET /api/finance/accounts-payable/:id
// @desc    Get bill by ID (includes PO-linked docs: indent, quotations, comparative statement, PO, GRN)
// @access  Private (Finance and Admin)
// @route   GET /api/finance/accounts-payable/:id/pending-voucher
// @desc    Get the pending voucher journalEntryId for an AP Bill
// @access  Private
router.get('/accounts-payable/:id/pending-voucher',
  authorize('super_admin', 'admin', 'finance_manager'),
  asyncHandler(async (req, res) => {
    const ApPaymentApplication = require('../models/finance/ApPaymentApplication');
    const apApp = await ApPaymentApplication.findOne({
      $or: [
        { accountsPayableId: req.params.id },
        { 'bills.billId': req.params.id }
      ],
      workflowStatus: { $ne: 'fully_approved' }
    }).select('journalEntryId payingJournalEntryId');

    if (!apApp || !apApp.journalEntryId) {
      return res.status(404).json({ message: 'No pending voucher found for this bill' });
    }

    res.json({
      journalEntryId: apApp.journalEntryId,
      payingJournalEntryId: apApp.payingJournalEntryId || null
    });
  })
);

router.get('/accounts-payable/:id',
  authorize('super_admin', 'admin', 'finance_manager'),
  asyncHandler(async (req, res) => {
    const { q, companyId, company } = await financeScope(req);
    let bill = await AccountsPayable.findOne(q({ _id: req.params.id }))
      .populate('companyId', 'name companyCode contactInfo')
      .populate('createdBy', 'firstName lastName email digitalSignature')
      .populate('lastModifiedBy', 'firstName lastName email')
      .populate('payeeEmployee', 'firstName lastName employeeId')
      .populate('approval.approvedBy', 'firstName lastName email digitalSignature')
      .populate('approvedBy', 'firstName lastName email digitalSignature')
      .populate('approvalChain.approver', 'firstName lastName email employeeId digitalSignature approvalStamp')
      .populate('financeApprovalAuthorities.assignedUser', 'firstName lastName email employeeId digitalSignature')
      .populate('workflowHistory.changedBy', 'firstName lastName email employeeId digitalSignature approvalStamp')
      .populate('observations.addedBy', 'firstName lastName email')
      .populate('lineItems.account')
      .lean();
    if (!bill) {
      // Helpful message when the bill exists but finance company selector on this browser doesn't match
      const anyBill = await AccountsPayable.findById(req.params.id)
        .select('billNumber companyId company')
        .lean();
      if (anyBill) {
        return res.status(403).json({
          success: false,
          message:
            `Bill ${anyBill.billNumber || ''} belongs to another finance company. ` +
            'Change the company selector at the top of the page to that company (or All Companies), then open the bill again.',
          billCompanyId: anyBill.companyId || null,
          selectedCompanyId: company?.isAll ? 'all' : (companyId || null)
        });
      }
      return res.status(404).json({
        success: false,
        message: 'Bill not found'
      });
    }
    assertDocCompany(bill, companyId, 'Bill');

    let poDetail = null;
    let targetPoId = null;
    if (bill.referenceType === 'purchase_order' && bill.referenceId) {
      targetPoId = bill.referenceId;
    } else if (bill.referenceType === 'grn' || (Array.isArray(bill.linkedGRNs) && bill.linkedGRNs.length > 0)) {
      const sampleGrnId = bill.referenceId || bill.linkedGRNs?.[0]?.grnId;
      if (sampleGrnId) {
        const grnDoc = await GoodsReceive.findById(sampleGrnId).lean();
        if (grnDoc?.purchaseOrder) targetPoId = grnDoc.purchaseOrder;
      }
    }

    if (targetPoId) {
      const Quotation = require('../models/procurement/Quotation');
      const Indent = require('../models/general/Indent');
      const po = await PurchaseOrder.findById(targetPoId)
        .populate('vendor', 'name email phone address payeeName cnic ntnCnic ntnNo')
        .populate('companyId', 'name code symbol')
        .populate({
          path: 'indent',
          populate: [{ path: 'companyId', select: 'name code symbol' }]
        })
        .populate('auditApprovedBy', 'firstName lastName email digitalSignature')
        .populate('auditReturnedBy', 'firstName lastName email')
        .populate('authorityApprovals.approver', 'firstName lastName email employeeId digitalSignature')
        .populate('workflowHistory.changedBy', 'firstName lastName email employeeId digitalSignature approvalStamp')
        .lean();
      if (po) {
        const indentId = po.indent?._id || po.indent;
        let quotations = [];
        let indent = null;
        if (indentId) {
          indent = await Indent.findById(indentId)
            .populate('requestedBy', 'firstName lastName name email digitalSignature')
            .populate('createdBy', 'firstName lastName email digitalSignature')
            .populate('updatedBy', 'firstName lastName email digitalSignature')
            .populate('approvedBy', 'firstName lastName email digitalSignature')
            .populate('movedToProcurementBy', 'firstName lastName email digitalSignature')
            .populate('department', 'name code')
            .populate('companyId', 'name code symbol')
            .populate('workflowHistory.changedBy', 'firstName lastName email employeeId digitalSignature approvalStamp')
            .lean();
          quotations = await Quotation.find({ indent: indentId }).populate('vendor', 'name email payeeName cnic ntnCnic').lean();
        }
        const grnIds = (bill.linkedGRNs && bill.linkedGRNs.length > 0)
          ? bill.linkedGRNs.map(g => g.grnId).filter(Boolean)
          : [];
        const grnQuery = grnIds.length > 0 ? { _id: { $in: grnIds } } : { purchaseOrder: po._id };
        const grns = await GoodsReceive.find(grnQuery).populate('supplier', 'name').populate('receivedBy', 'firstName lastName email').lean();
        poDetail = { po, indent, quotations, grns };
      }
    }

    let cashApproval = null;
    const caId = bill.employeeAdvanceAllocations?.[0]?.cashApprovalId;
    if (caId) {
      cashApproval = await CashApproval.findById(caId)
        .populate('workflowHistory.changedBy', 'firstName lastName name email digitalSignature')
        .lean();
    } else if (bill.internalNotes && /CA-\d{4}\d{2}-\d{4}/.test(bill.internalNotes)) {
      const caMatch = bill.internalNotes.match(/CA-\d{4}\d{2}-\d{4}/);
      if (caMatch) {
        cashApproval = await CashApproval.findOne({ caNumber: caMatch[0] })
          .populate('workflowHistory.changedBy', 'firstName lastName name email digitalSignature')
          .lean();
      }
    }

    // Fetch source UtilityBill for Centralized Store bills (approval chain lives there)
    let sourceUtilityBill = null;
    if (bill.referenceType === 'utility_bill' && bill.referenceId) {
      sourceUtilityBill = await UtilityBill.findById(bill.referenceId)
        .populate('createdBy', 'firstName lastName name email digitalSignature')
        .populate('approvedBy', 'firstName lastName name email digitalSignature')
        .populate('approvalChain.approver', 'firstName lastName name email digitalSignature')
        .populate('workflowHistory.changedBy', 'firstName lastName name email employeeId digitalSignature approvalStamp')
        .lean();
    }

    const fullWorkflowHistory = buildVendorBillFullWorkflowHistory({
      bill,
      indent: poDetail?.indent || null,
      po: poDetail?.po || null,
      cashApproval,
      sourceUtilityBill
    });

    res.json({
      success: true,
      data: {
        ...bill,
        vendorName: bill.vendor?.name || 'Unknown Vendor',
        vendorEmail: bill.vendor?.email || '',
        poDetail,
        cashApproval,
        sourceUtilityBill,
        fullWorkflowHistory
      }
    });
  })
);

// @route   POST /api/finance/accounts-payable/:id/payment
// @desc    Record payment for bill (with optional WHT deduction and specific bank account)
// @access  Private (Finance and Admin)
router.post('/accounts-payable/:id/payment',
  authorize('super_admin', 'admin', 'finance_manager'),
  [
    body('amount').isFloat({ min: 0 }).withMessage('Payment amount must be non-negative'),
    body('paymentMethod').isIn(['cash', 'check', 'credit_card', 'bank_transfer', 'ach', 'other']).withMessage('Valid payment method is required'),
    body('allocations').optional().isArray(),
    body('allocations.*.grnId').optional().isMongoId(),
    body('allocations.*.amount').optional().isFloat({ min: 0 })
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });
    }

    try {
      // Optional advanced GRN-level allocation validation
      if (Array.isArray(req.body.allocations) && req.body.allocations.length > 0) {
        const bill = await AccountsPayable.findById(req.params.id).lean();
        if (!bill) return res.status(404).json({ success: false, message: 'Bill not found' });
        const linked = Array.isArray(bill.linkedGRNs) ? bill.linkedGRNs : [];
        const paidByGrn = {};
        for (const p of (bill.payments || [])) {
          for (const a of (p.allocations || [])) {
            const k = String(a.grnId || '');
            if (!k) continue;
            paidByGrn[k] = (paidByGrn[k] || 0) + (Number(a.amount) || 0);
          }
        }
        let allocTotal = 0;
        for (const alloc of req.body.allocations) {
          const grnId = String(alloc.grnId);
          const amt = Math.round((Number(alloc.amount) || 0) * 100) / 100;
          allocTotal += amt;
          const linkedRow = linked.find((x) => String(x.grnId) === grnId);
          if (!linkedRow) {
            return res.status(400).json({ success: false, message: `Allocation GRN ${grnId} not linked to this bill` });
          }
          const billed = Number(linkedRow.amount) || 0;
          const alreadyPaid = Number(paidByGrn[grnId] || 0);
          const remaining = Math.round((billed - alreadyPaid) * 100) / 100;
          if (amt - remaining > 0.01) {
            return res.status(400).json({ success: false, message: `Allocation exceeds remaining for GRN ${linkedRow.grnNumber || grnId}` });
          }
        }
        const paymentAmount = Math.round((Number(req.body.amount) || 0) * 100) / 100;
        if (Math.abs(allocTotal - paymentAmount) > 0.01) {
          return res.status(400).json({ success: false, message: 'Sum of GRN allocations must equal payment amount' });
        }
      }

      const updatedBill = await FinanceHelper.recordAPPayment(req.params.id, {
        amount: req.body.amount,
        paymentMethod: req.body.paymentMethod,
        reference: req.body.reference,
        date: req.body.paymentDate,
        whtRate: Number(req.body.whtRate) || 0,
        bankAccountId: req.body.bankAccountId || null,
        allocations: req.body.allocations || [],
        createdBy: req.user._id,
        financeApprovalAuthorities: req.body.financeApprovalAuthorities,
        batchId: req.body.batchId
      });

      const pending = updatedBill?._pendingSettlement;
      const message = pending
        ? `Payment submitted: PKR ${Number(pending.amount || 0).toLocaleString('en-PK')} pending finance voucher approval. Bill will show as paid after all authorities approve.`
        : 'Payment recorded successfully';
      // Notify finance authorities via WhatsApp
      if (pending?.applicationId) {
        try {
          const apApp = await ApPaymentApplication.findById(pending.applicationId).select('financeApprovalAuthorities').lean();
          const fa = apApp?.financeApprovalAuthorities || {};
          const authIds = [fa.accountsManagerUser, fa.financeControllerUser].filter(Boolean);
          notifyApprovers(authIds, { docType: 'Bill Payment', docNumber: updatedBill.billNumber || '', fromUser: req.user }).catch(() => { });
          notifyChatApprovers(authIds, {
            docType: 'Bill Payment',
            docNumber: updatedBill.billNumber || '',
            url: `/finance/accounts-payable`,
            fromUser: req.user
          }).catch(() => { });
        } catch (_) { }
      }
      res.json({ success: true, message, data: updatedBill });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message || 'Failed to record payment' });
    }
  })
);

// @route   POST /api/finance/accounts-payable/advance-payment
// @desc    Record vendor advance before/against future bills
// @access  Private (Finance and Admin)
router.post('/accounts-payable/advance-payment',
  authorize('super_admin', 'admin', 'finance_manager'),
  [
    body('vendorName').trim().notEmpty().withMessage('Vendor name is required'),
    body('amount').isFloat({ min: 0.01 }).withMessage('Advance amount must be greater than zero'),
    body('paymentMethod').optional().isIn(['cash', 'check', 'cheque', 'credit_card', 'bank_transfer', 'ach', 'other']).withMessage('Valid payment method is required'),
    body('bankAccountId').optional().isMongoId().withMessage('Valid bank account id is required when provided')
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });

    const referenceType = req.body.referenceType || 'advance';
    const referenceId = req.body.referenceId || null;
    if (referenceId) {
      const poExists = await PurchaseOrder.exists({ _id: referenceId });
      if (poExists) {
        // Clear broken orphans (pending without voucher) so user can recreate cleanly
        await VendorAdvance.deleteMany({
          ...vendorAdvancesLinkedToPurchaseOrderFilter(referenceId),
          voucherWorkflowStatus: 'pending_authority',
          $or: [{ journalEntryId: null }, { journalEntryId: { $exists: false } }]
        });

        const blocked = await VendorAdvance.findOne({
          ...vendorAdvancesLinkedToPurchaseOrderFilter(referenceId),
          voucherWorkflowStatus: 'pending_authority',
          journalEntryId: { $ne: null }
        })
          .select('_id')
          .lean();
        if (blocked) {
          return res.status(400).json({
            success: false,
            message:
              'This PO already has a vendor advance waiting for finance voucher signatures. Finish approvals or reject that voucher before recording another advance for the same PO.'
          });
        }
      }
    }

    const mongoose = require('mongoose');
    const rawFa = req.body.financeApprovalAuthorities;
    const financeApprovalAuthorities =
      rawFa && typeof rawFa === 'object'
        ? {
            accountsManagerUser: rawFa.accountsManagerUser || rawFa.accountsManager,
            financeControllerUser: rawFa.financeControllerUser || rawFa.financeController
          }
        : null;
    const amId = financeApprovalAuthorities?.accountsManagerUser;
    const fcId = financeApprovalAuthorities?.financeControllerUser;
    if (!amId || !fcId || !mongoose.Types.ObjectId.isValid(String(amId)) || !mongoose.Types.ObjectId.isValid(String(fcId))) {
      return res.status(400).json({
        success: false,
        message: 'Sr Manager Accounts and GM Finance approvers are required (send financeApprovalAuthorities.accountsManagerUser and financeApprovalAuthorities.financeControllerUser as valid user ids).'
      });
    }

    const PlacementCompany = require('../models/hr/Company');
    const { normalizeCompanyId } = require('../utils/financeCompanyContext');
    const rawCompanyId = req.body.companyId;
    const rawPayingId = req.body.payingCompanyId;
    if (!rawCompanyId || String(rawCompanyId).toLowerCase() === 'all') {
      return res.status(400).json({
        success: false,
        message: 'Select a specific company to create this payment. All Companies is not allowed for vendor advance vouchers.'
      });
    }
    const resolvedCompanyId = normalizeCompanyId(rawCompanyId);
    if (!resolvedCompanyId) {
      return res.status(400).json({
        success: false,
        message: 'Invalid company. Choose a company from your company list.'
      });
    }
    const companyDoc = await PlacementCompany.findById(resolvedCompanyId).select('_id name isActive').lean();
    if (!companyDoc) {
      return res.status(400).json({
        success: false,
        message: 'Company not found. Choose a company from your company list.'
      });
    }
    if (companyDoc.isActive === false) {
      return res.status(400).json({
        success: false,
        message: `Company "${companyDoc.name}" is inactive. Choose an active company.`
      });
    }

    let resolvedPayingId = null;
    if (rawPayingId && String(rawPayingId).toLowerCase() !== 'all') {
      resolvedPayingId = normalizeCompanyId(rawPayingId);
      if (!resolvedPayingId) {
        return res.status(400).json({
          success: false,
          message: 'Invalid paying company. Choose a company from your company list.'
        });
      }
      const payingDoc = await PlacementCompany.findById(resolvedPayingId).select('_id name isActive').lean();
      if (!payingDoc) {
        return res.status(400).json({
          success: false,
          message: 'Paying company not found. Choose a company from your company list.'
        });
      }
      if (payingDoc.isActive === false) {
        return res.status(400).json({
          success: false,
          message: `Paying company "${payingDoc.name}" is inactive. Choose an active company.`
        });
      }
    }

    const advance = await FinanceHelper.recordVendorAdvance({
      vendorName: req.body.vendorName,
      vendorEmail: req.body.vendorEmail || '',
      vendorId: req.body.vendorId || null,
      amount: req.body.amount,
      paymentMethod: req.body.paymentMethod || 'bank_transfer',
      reference: req.body.reference,
      chequeNumber: req.body.chequeNumber || null,
      date: req.body.paymentDate,
      bankAccountId: req.body.bankAccountId || null,
      department: req.body.department || 'procurement',
      module: req.body.module || 'procurement',
      referenceType,
      referenceId,
      createdBy: req.user._id,
      financeApprovalAuthorities,
      companyId: resolvedCompanyId,
      payingCompanyId: resolvedPayingId || resolvedCompanyId,
      categoryLines: req.body.categoryLines || []
    });

    const message =
      advance.voucherWorkflowStatus === 'pending_authority'
        ? (advance.payingJournalEntryId
          ? 'Vendor advance saved with intercompany vouchers (original company + paying company). Both are pending finance signatures — open them from Vouchers to approve.'
          : 'Vendor advance saved. Voucher is pending finance signatures — open it from Vouchers to approve. The PO (if linked) is auto-approved only after the voucher signed document is marked signed.')
        : 'Vendor advance recorded successfully';

    res.json({ success: true, message, data: advance });
  })
);

// @route   POST /api/finance/vendor-advances/:id/ensure-voucher
// @desc    Create missing draft voucher for an advance that has no journalEntryId
// @access  Private (Finance and Admin)
router.post('/vendor-advances/:id/ensure-voucher',
  authorize('super_admin', 'admin', 'finance_manager'),
  asyncHandler(async (req, res) => {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid vendor advance id' });
    }
    const PlacementCompany = require('../models/hr/Company');
    const { normalizeCompanyId } = require('../utils/financeCompanyContext');
    const rawCompanyId = req.body.companyId;
    if (!rawCompanyId || String(rawCompanyId).toLowerCase() === 'all') {
      return res.status(400).json({
        success: false,
        message: 'Select a specific company to create this voucher. All Companies is not allowed.'
      });
    }
    const companyId = normalizeCompanyId(rawCompanyId);
    if (!companyId) {
      return res.status(400).json({
        success: false,
        message: 'Invalid company. Choose a company from your company list.'
      });
    }
    const companyDoc = await PlacementCompany.findById(companyId).select('_id isActive name').lean();
    if (!companyDoc) {
      return res.status(400).json({
        success: false,
        message: 'Company not found. Choose a company from your company list.'
      });
    }
    if (companyDoc.isActive === false) {
      return res.status(400).json({
        success: false,
        message: `Company "${companyDoc.name}" is inactive. Choose an active company.`
      });
    }
    const advance = await FinanceHelper.ensureVendorAdvanceVoucher(req.params.id, {
      companyId,
      payingCompanyId: normalizeCompanyId(req.body.payingCompanyId) || undefined,
      createdBy: req.user._id
    });
    res.json({
      success: true,
      message: advance.payingJournalEntryId
        ? 'Intercompany vouchers ready — original company + paying company'
        : (advance.journalEntryId
          ? 'Voucher is ready — open it from Advance history'
          : 'No voucher created'),
      data: advance
    });
  })
);

// @route   POST /api/finance/vendor-advances/tag-vendor-parties
// @desc    Backfill Vendor party tags on advance voucher debit lines (no amount change)
// @access  Private (Finance and Admin)
router.post('/vendor-advances/tag-vendor-parties',
  authorize('super_admin', 'admin', 'finance_manager'),
  asyncHandler(async (req, res) => {
    const advanceId = req.body?.advanceId || null;
    if (advanceId && !mongoose.Types.ObjectId.isValid(advanceId)) {
      return res.status(400).json({ success: false, message: 'Invalid vendor advance id' });
    }
    const result = await FinanceHelper.tagVendorAdvanceJournalParties(advanceId || null);
    res.json({
      success: true,
      message: `Tagged vendor party on ${result.updatedJes} voucher(s) / ${result.updatedLines} line(s)`,
      data: result
    });
  })
);

// @route   DELETE /api/finance/vendor-advances/:id
// @desc    Remove a broken advance (no voucher / not applied) so payment can be re-recorded
// @access  Private (Finance and Admin)
router.delete('/vendor-advances/:id',
  authorize('super_admin', 'admin', 'finance_manager'),
  asyncHandler(async (req, res) => {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid vendor advance id' });
    }
    const advance = await VendorAdvance.findById(req.params.id);
    if (!advance) {
      return res.status(404).json({ success: false, message: 'Vendor advance not found' });
    }

    const hasJe = Boolean(advance.journalEntryId);
    const applied = Number(advance.appliedAmount || 0);
    const isBrokenOrphan =
      !hasJe
      && applied <= 0
      && ['pending_authority', 'rejected', 'immediate'].includes(String(advance.voucherWorkflowStatus || ''));

    if (!isBrokenOrphan) {
      return res.status(400).json({
        success: false,
        message: hasJe
          ? 'This advance already has a voucher. Open/reject that voucher instead of deleting the advance.'
          : 'This advance cannot be deleted (already applied or not eligible).'
      });
    }

    await VendorAdvance.findByIdAndDelete(advance._id);
    res.json({
      success: true,
      message: 'Broken advance removed. You can record the payment again for this vendor/PO.'
    });
  })
);

// @route   POST /api/finance/vendor-advances/cleanup-orphans
// @desc    Delete all pending advances that never got a journal voucher
// @access  Private (Finance and Admin)
router.post('/vendor-advances/cleanup-orphans',
  authorize('super_admin', 'admin', 'finance_manager'),
  asyncHandler(async (req, res) => {
    const filter = {
      voucherWorkflowStatus: 'pending_authority',
      $or: [{ journalEntryId: null }, { journalEntryId: { $exists: false } }],
      appliedAmount: { $lte: 0 }
    };
    const result = await VendorAdvance.deleteMany(filter);
    res.json({
      success: true,
      message: `Removed ${result.deletedCount || 0} broken advance(s) with no voucher. You can record those payments again.`,
      data: { deletedCount: result.deletedCount || 0 }
    });
  })
);

// @route   POST /api/finance/accounts-payable/:id/apply-advance
// @desc    Apply vendor or employee (cash approval) advance to AP bill
router.post('/accounts-payable/:id/apply-advance',
  authorize('super_admin', 'admin', 'finance_manager'),
  [
    body('amount').optional().isFloat({ min: 0.01 }).withMessage('Apply amount must be greater than zero'),
    body('employeeId').optional().isMongoId().withMessage('Invalid employeeId'),
    body('source').optional().isIn(['vendor', 'employee', 'auto']).withMessage('Invalid advance source'),
    body('allocations').optional().isArray().withMessage('allocations must be an array'),
    body('allocations.*.cashApprovalId').optional().isMongoId().withMessage('Invalid cashApprovalId'),
    body('allocations.*.amount').optional().isFloat({ min: 0.01 }).withMessage('Allocation amount must be greater than zero')
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });

    const bill = await AccountsPayable.findById(req.params.id).select('payeeEmployee vendor');
    if (!bill) return res.status(404).json({ success: false, message: 'Bill not found' });

    const source = String(req.body.source || 'auto').toLowerCase();
    const employeeId = req.body.employeeId || bill.payeeEmployee || null;
    const allocations = Array.isArray(req.body.allocations) ? req.body.allocations : [];
    let result = { applied: 0 };

    if (source === 'employee' || (source === 'auto' && employeeId) || allocations.length > 0) {
      try {
        result = await FinanceHelper.applyEmployeeAdvanceToBill(
          req.params.id,
          req.body.amount ?? null,
          employeeId,
          req.user._id,
          {
            allocations,
            financeApprovalAuthorities: req.body.financeApprovalAuthorities
          }
        );
      } catch (empErr) {
        if (source === 'employee' || allocations.length > 0) throw empErr;
      }
    }

    if (Number(result.applied || 0) <= 0 && Number(result.pending || 0) <= 0 && source !== 'employee' && allocations.length === 0) {
      result = await FinanceHelper.applyVendorAdvanceToBill(req.params.id, req.body.amount ?? null, req.user._id, {
        financeApprovalAuthorities: req.body.financeApprovalAuthorities
      });
    }

    const pending = Number(result.pending || 0);
    const message = pending > 0
      ? `Settlement submitted: PKR ${pending.toLocaleString('en-PK')} pending finance voucher approval. Bill will show as paid after all authorities approve.`
      : `Advance applied: PKR ${Number(result.applied || 0).toLocaleString('en-PK')}`;

    res.json({ success: true, message, data: result });
  })
);

// ================================
// ACCOUNTS PAYABLE ROUTES
// ================================

// @route   GET /api/finance/accounts-payable
// @desc    Get all accounts payable
// @access  Private (Finance and Admin)
router.get('/accounts-payable', 
  authorize('super_admin', 'admin', 'finance_manager'), 
  asyncHandler(async (req, res) => {
    const { 
      page = 1, 
      limit = 20, 
      status,
      vendorId,
      vendor,
      employeeId,
      startDate,
      endDate,
      search,
      billType
    } = req.query;

    const company = await resolveCompanyForFinanceRoute(req);
    const baseFilters = {};

    if (status) {
      if (status === 'unpaid') {
        // Include draft COA bills awaiting department approval so creators can find them.
        // Still hide audit-queue bills until Audit finishes (same as before).
        // Payment UI already blocks draft / Submitted dept-approval bills.
        baseFilters.status = {
          $ne: 'paid',
          // Hide only in-flight audit queue; keep Returned from Audit visible so finance can correct/resubmit
          $nin: ['Pending Audit', 'Forwarded to Audit Director']
        };
      } else if (status === 'pending_dept_approval') {
        baseFilters.status = 'draft';
        baseFilters.approvalStatus = 'Submitted';
        baseFilters.referenceType = 'manual';
      } else {
        baseFilters.status = status;
      }
    } else {
      // By default in Finance AP, hide bills still in pre-audit / audit director queue.
      // Returned from Audit stays visible so finance can fix observations and resend.
      baseFilters.status = { $nin: ['Pending Audit', 'Forwarded to Audit Director'] };
    }

    // Bill type filter (server-side so counts/pages cover the full set)
    if (billType === 'store') {
      baseFilters.$and = [
        ...(baseFilters.$and || []),
        {
          $or: [
            { referenceType: 'utility_bill' },
            { module: 'taj_utilities' }
          ]
        }
      ];
    } else if (billType === 'po') {
      baseFilters.referenceType = { $in: ['purchase_order', 'grn'] };
    } else if (billType === 'category') {
      baseFilters.$and = [
        ...(baseFilters.$and || []),
        {
          $and: [
            {
              $or: [
                { referenceType: 'manual' },
                { module: 'finance' },
                { referenceType: { $exists: false } },
                { referenceType: null },
                { referenceType: '' }
              ]
            },
            { referenceType: { $nin: ['utility_bill', 'purchase_order', 'grn'] } },
            { module: { $ne: 'taj_utilities' } }
          ]
        }
      ];
    }
    if (vendorId) baseFilters['vendor.vendorId'] = vendorId;
    else if (vendor) {
      baseFilters['vendor.name'] = { $regex: escapeRegex(String(vendor).trim()), $options: 'i' };
    }
    if (employeeId) baseFilters.payeeEmployee = employeeId;
    if (search && String(search).trim()) {
      const rawSearch = String(search).trim();
      const tokens = rawSearch.split(/\s+/).filter(Boolean);
      const tokenConditions = [];

      for (const token of tokens) {
        const escapedToken = escapeRegex(token);
        const tokenRegex = new RegExp(escapedToken, 'i');
        const orConditions = [
          { billNumber: tokenRegex },
          { vendorInvoiceNumber: tokenRegex },
          { 'vendor.name': tokenRegex },
          { 'vendor.email': tokenRegex },
          { 'vendor.phone': tokenRegex },
          { 'vendor.taxId': tokenRegex },
          { company: tokenRegex },
          { project: tokenRegex },
          { department: tokenRegex },
          { module: tokenRegex },
          { status: tokenRegex },
          { paymentTerms: tokenRegex },
          { referenceType: tokenRegex },
          { notes: tokenRegex },
          { internalNotes: tokenRegex },
          { description: tokenRegex },
          { forWhat: tokenRegex },
          { 'lineItems.description': tokenRegex },
          { 'lineItems.itemName': tokenRegex },
          { 'lineItems.company': tokenRegex },
          { 'lineItems.project': tokenRegex },
          { 'linkedGRNs.grnNumber': tokenRegex },
          { 'linkedGRNs.poNumber': tokenRegex }
        ];

        // Search employee payees by first/last name or code
        const matchingEmployees = await Employee.find({
          $or: [
            { firstName: tokenRegex },
            { lastName: tokenRegex },
            { employeeId: tokenRegex }
          ]
        }).select('_id').lean();

        if (matchingEmployees.length > 0) {
          orConditions.push({
            payeeEmployee: { $in: matchingEmployees.map((e) => e._id) }
          });
        }

        // Match numeric / amount fields
        const cleanDigits = token.replace(/[^0-9.]/g, '');
        if (cleanDigits && !isNaN(cleanDigits)) {
          const numVal = parseFloat(cleanDigits);
          orConditions.push({ totalAmount: numVal });
          orConditions.push({ amountPaid: numVal });
          orConditions.push({ advanceApplied: numVal });
          orConditions.push({
            $expr: {
              $or: [
                {
                  $regexMatch: {
                    input: { $toString: { $ifNull: ['$totalAmount', 0] } },
                    regex: escapeRegex(cleanDigits)
                  }
                },
                {
                  $regexMatch: {
                    input: { $toString: { $ifNull: ['$amountPaid', 0] } },
                    regex: escapeRegex(cleanDigits)
                  }
                },
                {
                  $regexMatch: {
                    input: { $toString: { $ifNull: ['$advanceApplied', 0] } },
                    regex: escapeRegex(cleanDigits)
                  }
                }
              ]
            }
          });
        }

        tokenConditions.push({ $or: orConditions });
      }

      if (tokenConditions.length === 1) {
        baseFilters.$or = tokenConditions[0].$or;
      } else if (tokenConditions.length > 1) {
        baseFilters.$and = baseFilters.$and ? [...baseFilters.$and, ...tokenConditions] : tokenConditions;
      }
    }
    if (startDate || endDate) {
      baseFilters.billDate = {};
      if (startDate) {
        const start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
        baseFilters.billDate.$gte = start;
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        baseFilters.billDate.$lte = end;
      }
    }

    const filters = companyQuery(baseFilters, company);

    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    // Pending utility / centralized-store bills across ALL pages (not just current page)
    const pendingUtilityFilters = companyQuery({
      $or: [
        { referenceType: 'utility_bill' },
        { module: 'taj_utilities' }
      ],
      status: {
        $nin: [
          'paid',
          'cancelled',
          'Pending Audit',
          'Forwarded to Audit Director',
          'Returned from Audit'
        ]
      }
    }, company);

    // Unpaid utility bills due today or already overdue (for warning popup)
    const warningDayStart = new Date();
    warningDayStart.setHours(0, 0, 0, 0);
    const warningDayEnd = new Date(warningDayStart);
    warningDayEnd.setHours(23, 59, 59, 999);

    const dueUtilityWarningFilters = companyQuery({
      $or: [
        { referenceType: 'utility_bill' },
        { module: 'taj_utilities' }
      ],
      status: {
        $nin: [
          'paid',
          'cancelled',
          'Pending Audit',
          'Forwarded to Audit Director',
          'Returned from Audit'
        ]
      },
      dueDate: { $ne: null, $lte: warningDayEnd }
    }, company);
    
    const [bills, totalCount, pendingUtilityBills, dueUtilityWarningBills] = await Promise.all([
      AccountsPayable.find(filters)
        .populate('payeeEmployee', 'firstName lastName employeeId')
        .sort({ billDate: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      AccountsPayable.countDocuments(filters),
      AccountsPayable.countDocuments(pendingUtilityFilters),
      AccountsPayable.find(dueUtilityWarningFilters)
        .select('billNumber vendor dueDate totalAmount amountPaid advanceApplied advancePending paymentPending duePaymentAmount status company project')
        .sort({ dueDate: 1, billNumber: 1 })
        .limit(100)
        .lean()
    ]);

    // Calculate summary using aggregation pipeline for better performance
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const summaryResult = await AccountsPayable.aggregate([
      { $match: filters },
      {
        $project: {
          totalAmount: { $ifNull: ['$totalAmount', 0] },
          amountPaid: { $ifNull: ['$amountPaid', 0] },
          advanceApplied: { $ifNull: ['$advanceApplied', 0] },
          advancePending: { $ifNull: ['$advancePending', 0] },
          paymentPending: { $ifNull: ['$paymentPending', 0] },
          dueDate: 1,
          openBalance: {
            $subtract: [
              { $subtract: ['$totalAmount', '$amountPaid'] },
              { $add: ['$advanceApplied', { $ifNull: ['$advancePending', 0] }, { $ifNull: ['$paymentPending', 0] }] }
            ]
          }
        }
      },
      {
        $group: {
          _id: null,
          totalOutstanding: { $sum: '$openBalance' },
          totalPaid: { $sum: { $add: ['$amountPaid', '$advanceApplied'] } },
          totalOverdue: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $ne: ['$dueDate', null] },
                    { $lt: ['$dueDate', today] },
                    { $gt: ['$openBalance', 0] }
                  ]
                },
                '$openBalance',
                0
              ]
            }
          }
        }
      }
    ]);

    const dueUtilityWarnings = (dueUtilityWarningBills || [])
      .map((bill) => {
        const outstanding = FinanceHelper.getAPOutstanding(bill)
          - (Number(bill.advancePending) || 0)
          - (Number(bill.paymentPending) || 0);
        const outstandingRounded = Math.round(outstanding * 100) / 100;
        if (outstandingRounded <= 0) return null;
        const due = bill.dueDate ? new Date(bill.dueDate) : null;
        const isOverdue = due && due < warningDayStart;
        const isDueToday = due && due >= warningDayStart && due <= warningDayEnd;
        return {
          _id: bill._id,
          billNumber: bill.billNumber,
          vendorName: bill.vendor?.name || 'Unknown Vendor',
          dueDate: bill.dueDate,
          totalAmount: bill.totalAmount || 0,
          duePaymentAmount: bill.duePaymentAmount || 0,
          outstandingAmount: outstandingRounded,
          status: bill.status,
          company: bill.company || '',
          project: bill.project || '',
          urgency: isOverdue ? 'overdue' : (isDueToday ? 'due_today' : 'due')
        };
      })
      .filter(Boolean);

    const summary = {
      totalOutstanding: 0,
      totalOverdue: 0,
      totalPaid: 0,
      totalBills: totalCount,
      ...(summaryResult[0] || {}),
      pendingUtilityBills: pendingUtilityBills || 0,
      dueUtilityWarningCount: dueUtilityWarnings.length,
      dueUtilityWarnings
    };

    // Transform bills to match frontend expectations
    const transformedBills = bills.map(bill => ({
      ...bill,
      vendorName: bill.vendor?.name || 'Unknown Vendor',
      vendorEmail: bill.vendor?.email || '',
      // Keep both values explicit for UI/reporting:
      // - paidAmount: cash/bank paid
      // - settledAmount: cash/bank + advance applied
      paidAmount: bill.amountPaid || 0,
      settledAmount: Math.round((((bill.amountPaid || 0) + (bill.advanceApplied || 0)) * 100)) / 100,
      advanceApplied: bill.advanceApplied || 0,
      advancePending: bill.advancePending || 0,
      paymentPending: bill.paymentPending || 0,
      settlementPending: Math.round(
        (((bill.advancePending || 0) + (bill.paymentPending || 0)) * 100)
      ) / 100,
      outstandingAmount: Math.round(
        (FinanceHelper.getAPOutstanding(bill)
          - (bill.advancePending || 0)
          - (bill.paymentPending || 0)) * 100
      ) / 100
    }));

    const totalPages = Math.ceil(totalCount / parseInt(limit));

    // Prevent caching to ensure fresh data
    res.set({
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0'
    });

    res.json({
      success: true,
      data: {
        bills: transformedBills,
        summary,
        pagination: {
          currentPage: parseInt(page),
          totalPages,
          totalCount,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1,
          limit: parseInt(limit)
        }
      }
    });
  })
);

const COA_DEPT_APPROVAL_ROLE_LABELS = ['Sr Manager Finance', 'GM Finance'];

const normalizeCoaDepartmentApproverIds = (body = {}) => {
  const fromList = Array.isArray(body.departmentApproverIds)
    ? body.departmentApproverIds.map((id) => String(id || '').trim()).filter(Boolean)
    : [];
  if (fromList.length >= 2) return [...new Set(fromList)].slice(0, 2);

  const dept = body.departmentApprovalAuthorities || {};
  const sr = dept.srManagerFinance || body.srManagerFinance || null;
  const gm = dept.gmFinance || body.gmFinance || null;
  const ids = [sr, gm].map((id) => String(id || '').trim()).filter(Boolean);
  return [...new Set(ids)].slice(0, 2);
};

const normalizeApPaymentTerms = (raw) => {
  const v = String(raw || '').trim();
  if (!v) return undefined;
  const allowed = new Set([
    'net_15', 'net_30', 'net_45', 'net_60', 'due_on_receipt', 'custom',
    'Cash', 'cash', 'Immediate', 'immediate'
  ]);
  if (allowed.has(v)) return v;
  const map = {
    '15 days': 'net_15',
    '30 days': 'net_30',
    '45 days': 'net_45',
    '60 days': 'net_60',
    '90 days': 'net_90',
    cash: 'Cash',
    'due on receipt': 'due_on_receipt'
  };
  const mapped = map[v.toLowerCase()];
  if (mapped && allowed.has(mapped)) return mapped;
  return 'net_30';
};

const notifyCoaBillAuditQueue = async ({ actorId, bill }) => {
  const users = await User.find({
    isActive: true,
    role: { $in: ['audit_manager', 'auditor', 'audit_director', 'super_admin', 'admin'] }
  }).select('_id');
  const recipientIds = users.map((user) => String(user._id));
  if (!recipientIds.length) return;
  const { createAndEmitNotification } = require('../services/realtimeNotificationService');
  await createAndEmitNotification({
    recipientIds,
    title: 'Chart of Accounts bill pending Pre Audit',
    message: `Vendor Bill ${bill.billNumber || bill._id} completed department approval and moved to Audit queue.`,
    type: 'info',
    category: 'approval',
    priority: 'high',
    actionUrl: '/audit',
    createdBy: actorId,
    excludeUserId: actorId,
    metadata: {
      module: 'audit',
      entityId: bill._id,
      entityType: 'AccountsPayable',
      queueStage: 'pending_audit',
      targetModule: 'audit',
      targetTab: 'pre_audit'
    }
  });
};

// @route   POST /api/finance/accounts-payable
// @desc    Create Chart of Accounts vendor bill (department approval → audit → finance)
// @access  Private (Finance and Admin)
router.post('/accounts-payable',
  authorize('super_admin', 'admin', 'finance_manager'),
  [
    body('vendor.name').trim().notEmpty().withMessage('Vendor name is required'),
    body('billNumber').trim().notEmpty().withMessage('Bill number is required'),
    body('totalAmount').isFloat({ min: 0 }).withMessage('Total amount must be non-negative'),
    body('lineItems').isArray({ min: 1 }).withMessage('At least one line item is required')
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      console.error("Journal Entry Validation Error (PUT):", JSON.stringify(errors.array(), null, 2));
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const approverIds = normalizeCoaDepartmentApproverIds(req.body);
    if (approverIds.length !== 2) {
      return res.status(400).json({
        success: false,
        message: 'Select Sr Manager Finance and GM Finance as department approval authorities (same pattern as Centralized Store Manager / HOD).'
      });
    }

    const actorId = String(req.user._id || req.user.id || '');
    if (approverIds.includes(actorId)) {
      return res.status(400).json({
        success: false,
        message: 'Requester cannot be selected as a department approval authority'
      });
    }

    const approvers = await User.find({ _id: { $in: approverIds }, isActive: true }).select('_id');
    if (approvers.length !== 2) {
      return res.status(400).json({
        success: false,
        message: 'Selected department approval authorities are not valid'
      });
    }

    const lineItems = (req.body.lineItems || []).map(li => ({
      description: li.description || 'Line item',
      quantity: Number(li.quantity) || 1,
      unitPrice: Number(li.unitPrice) ?? Number(li.amount) ?? 0,
      amount: (Number(li.quantity) || 1) * (Number(li.unitPrice) ?? Number(li.amount) ?? 0),
      taxRate: Number(li.taxRate) || 0,
      taxAmount: Number(li.taxAmount) || 0,
      account: li.account || li.accountId || null,
      accountNumber: li.accountNumber || '',
      company: li.company || req.body.company || '',
      project: li.project || req.body.project || ''
    })).filter(li => li.unitPrice >= 0);

    const approvalChain = approverIds.map((approverId, idx) => ({
      approver: approverId,
      roleLabel: COA_DEPT_APPROVAL_ROLE_LABELS[idx] || `Approver ${idx + 1}`,
      status: 'pending'
    }));

    const company = await resolveCompanyForFinanceRoute(req);
    const apEntry = await FinanceHelper.createAPFromBill({
      companyId: company._id,
      company: req.body.company || '',
      project: req.body.project || '',
      vendorName: req.body.vendor.name,
      vendorEmail: req.body.vendor.email || '',
      vendorId: req.body.vendor.vendorId || req.body.vendor._id || null,
      billNumber: req.body.billNumber,
      vendorInvoiceNumber: req.body.vendorInvoiceNumber || '',
      billDate: req.body.billDate,
      dueDate: req.body.dueDate,
      amount: Number(req.body.totalAmount) || 0,
      paymentTerms: normalizeApPaymentTerms(req.body.paymentTerms),
      notes: req.body.notes || req.body.memo || lineItems.map(l => l.description).filter(Boolean).join('; ') || `Expense Bill — ${req.body.billNumber}`,
      department: req.body.department || 'finance',
      module: 'finance',
      referenceId: null,
      referenceType: 'manual',
      lineItems: lineItems.length > 0 ? lineItems : undefined,
      skipJournal: true,
      status: 'draft',
      approvalStatus: 'Submitted',
      approvalChain,
      workflowHistory: [{
        fromStatus: 'Draft',
        toStatus: 'Submitted',
        changedBy: req.user._id,
        changedAt: new Date(),
        comments: 'Submitted for department approval (Sr Manager Finance → GM Finance)',
        module: 'Finance'
      }],
      createdBy: req.user._id
    });

    if (Array.isArray(req.body.attachments) && req.body.attachments.length > 0 && apEntry) {
      apEntry.attachments = req.body.attachments;
      await apEntry.save();
    }

    notifyChatApprovers(approverIds, {
      docType: 'Chart of Accounts Bill',
      docNumber: apEntry.billNumber || '',
      url: `/finance/accounts-payable`,
      fromUser: req.user
    }).catch(() => {});

    res.status(201).json({
      success: true,
      message: 'Bill created and sent for department approval (Sr Manager Finance → GM Finance). After approval it goes to Audit, then Finance.',
      data: apEntry
    });
  })
);

// @route   POST /api/finance/accounts-payable/:id/department-approve
// @desc    Department approval step for Chart of Accounts bills (like Centralized Store Manager/HOD)
// @access  Private (assigned approvalChain approver)
router.post('/accounts-payable/:id/department-approve',
  asyncHandler(async (req, res) => {
    const bill = await AccountsPayable.findById(req.params.id);
    if (!bill) {
      return res.status(404).json({ success: false, message: 'Bill not found' });
    }
    if (bill.approvalStatus !== 'Submitted') {
      return res.status(400).json({ success: false, message: 'Only bills submitted for department approval can be approved' });
    }

    const userId = String(req.user._id || req.user.id || '');
    if (String(bill.createdBy) === userId) {
      return res.status(403).json({
        success: false,
        message: 'Requester cannot approve department approval authority on their own bill'
      });
    }

    const pendingIndex = (bill.approvalChain || []).findIndex((step) => (
      String(step.approver) === userId && step.status === 'pending'
    ));
    if (pendingIndex === -1) {
      return res.status(403).json({ success: false, message: 'You are not the pending department approval authority for this bill' });
    }

    // Sequential chain: earlier steps must be approved first
    const earlierPending = (bill.approvalChain || []).findIndex((step, idx) => (
      idx < pendingIndex && step.status === 'pending'
    ));
    if (earlierPending !== -1) {
      return res.status(400).json({
        success: false,
        message: 'Previous department approval authority must approve first'
      });
    }

    bill.approvalChain[pendingIndex].status = 'approved';
    bill.approvalChain[pendingIndex].actedAt = new Date();
    if (req.body?.comments) bill.approvalChain[pendingIndex].comment = String(req.body.comments);

    const roleLabel = bill.approvalChain[pendingIndex].roleLabel || COA_DEPT_APPROVAL_ROLE_LABELS[pendingIndex] || 'Department Approver';
    const previousStatus = bill.approvalStatus;
    const allApproved = (bill.approvalChain || []).every((step) => step.status === 'approved');

    bill.workflowHistory = Array.isArray(bill.workflowHistory) ? bill.workflowHistory : [];
    if (allApproved) {
      bill.approvalStatus = 'Approved';
      bill.approvedBy = userId;
      bill.approvedAt = new Date();
      bill.status = 'Pending Audit';
      bill.workflowHistory.push({
        fromStatus: previousStatus,
        toStatus: 'Approved',
        changedBy: userId,
        changedAt: new Date(),
        comments: req.body?.comments || `${roleLabel} approved — department approval complete`,
        module: 'Finance'
      });
      bill.workflowHistory.push({
        fromStatus: 'Approved',
        toStatus: 'Pending Audit',
        changedBy: userId,
        changedAt: new Date(),
        comments: 'Sent to Pre-Audit after department approval (Sr Manager Finance / GM Finance)',
        module: 'Finance'
      });
    } else {
      bill.workflowHistory.push({
        fromStatus: previousStatus,
        toStatus: previousStatus,
        changedBy: userId,
        changedAt: new Date(),
        comments: req.body?.comments || `${roleLabel} approved`,
        module: 'Finance'
      });
    }

    await bill.save();

    if (allApproved) {
      await notifyCoaBillAuditQueue({ actorId: userId, bill });
    }

    const populated = await AccountsPayable.findById(bill._id)
      .populate('approvalChain.approver', 'firstName lastName email employeeId digitalSignature')
      .populate('createdBy', 'firstName lastName email');

    res.json({
      success: true,
      message: allApproved
        ? 'Department approval complete. Bill sent to Pre-Audit.'
        : 'Department approval recorded.',
      data: populated
    });
  })
);

// @route   POST /api/finance/accounts-payable/:id/department-reject
// @desc    Reject Chart of Accounts bill at department approval stage
// @access  Private (assigned approvalChain approver)
router.post('/accounts-payable/:id/department-reject',
  asyncHandler(async (req, res) => {
    const reason = String(req.body?.rejectionReason || req.body?.comments || '').trim();
    if (!reason) {
      return res.status(400).json({ success: false, message: 'Rejection reason is required' });
    }

    const bill = await AccountsPayable.findById(req.params.id);
    if (!bill) {
      return res.status(404).json({ success: false, message: 'Bill not found' });
    }
    if (bill.approvalStatus !== 'Submitted') {
      return res.status(400).json({ success: false, message: 'Only bills submitted for department approval can be rejected' });
    }

    const userId = String(req.user._id || req.user.id || '');
    if (String(bill.createdBy) === userId) {
      return res.status(403).json({
        success: false,
        message: 'Requester cannot reject department approval authority on their own bill'
      });
    }

    const pendingIndex = (bill.approvalChain || []).findIndex((step) => (
      String(step.approver) === userId && step.status === 'pending'
    ));
    if (pendingIndex === -1) {
      return res.status(403).json({ success: false, message: 'You are not the pending department approval authority for this bill' });
    }

    bill.approvalChain[pendingIndex].status = 'rejected';
    bill.approvalChain[pendingIndex].actedAt = new Date();
    bill.approvalChain[pendingIndex].comment = reason;

    const previousStatus = bill.approvalStatus;
    bill.approvalStatus = 'Rejected';
    bill.rejectedBy = userId;
    bill.rejectedAt = new Date();
    bill.rejectionReason = reason;
    bill.status = 'draft';
    bill.workflowHistory = Array.isArray(bill.workflowHistory) ? bill.workflowHistory : [];
    bill.workflowHistory.push({
      fromStatus: previousStatus,
      toStatus: 'Rejected',
      changedBy: userId,
      changedAt: new Date(),
      comments: reason,
      module: 'Finance'
    });
    await bill.save();

    const populated = await AccountsPayable.findById(bill._id)
      .populate('approvalChain.approver', 'firstName lastName email employeeId digitalSignature')
      .populate('createdBy', 'firstName lastName email');

    res.json({ success: true, message: 'Bill rejected at department approval', data: populated });
  })
);

// @route   POST /api/finance/accounts-payable/:id/resubmit-to-audit
// @desc    Resubmit vendor bill to Pre-Audit after audit return/reject with observations
// @access  Private (Finance and Admin)
router.post('/accounts-payable/:id/resubmit-to-audit',
  authorize('super_admin', 'admin', 'finance_manager', 'general_manager'),
  asyncHandler(async (req, res) => {
    const bill = await AccountsPayable.findById(req.params.id);
    if (!bill) {
      return res.status(404).json({ success: false, message: 'Bill not found' });
    }
    if (bill.status !== 'Returned from Audit') {
      return res.status(400).json({
        success: false,
        message: 'Only bills returned from audit can be resubmitted to Pre-Audit'
      });
    }

    const userId = req.user.id || req.user._id;
    const comments = String(req.body?.comments || '').trim() || 'Resubmitted to Pre-Audit after audit observations';
    bill.workflowHistory = Array.isArray(bill.workflowHistory) ? bill.workflowHistory : [];
    bill.workflowHistory.push({
      fromStatus: 'Returned from Audit',
      toStatus: 'Pending Audit',
      changedBy: userId,
      changedAt: new Date(),
      comments,
      module: 'Finance'
    });
    bill.status = 'Pending Audit';
    bill.preAuditInitialApprovedAt = undefined;
    bill.preAuditInitialApprovedBy = undefined;
    bill.lastModifiedBy = userId;
    await bill.save();

    await notifyCoaBillAuditQueue({ actorId: userId, bill });

    const populated = await AccountsPayable.findById(bill._id)
      .populate('createdBy', 'firstName lastName email')
      .populate('observations.addedBy', 'firstName lastName email');

    res.json({
      success: true,
      message: 'Bill resubmitted to Pre-Audit successfully',
      data: populated
    });
  })
);

// @route   POST /api/finance/accounts-payable/:id/finance-return
// @desc    Finance rejects bill back to initiator for edit/resubmit.
//          Department approvalChain / approvalStatus stay intact — no re-approval.
// @access  Private (Finance and Admin)
router.post('/accounts-payable/:id/finance-return',
  authorize('super_admin', 'admin', 'finance_manager', 'general_manager'),
  asyncHandler(async (req, res) => {
    const bill = await AccountsPayable.findById(req.params.id);
    if (!bill) {
      return res.status(404).json({ success: false, message: 'Bill not found' });
    }

    const allowedFrom = ['approved', 'received', 'overdue'];
    if (!allowedFrom.includes(bill.status)) {
      return res.status(400).json({
        success: false,
        message: 'Only approved vendor bills (awaiting payment) can be returned to the initiator'
      });
    }

    const paid = Number(bill.amountPaid ?? bill.paidAmount ?? 0) || 0;
    const advanceApplied = Number(bill.advanceApplied || 0) || 0;
    const settlementPending = Number(
      bill.settlementPending ?? ((bill.advancePending || 0) + (bill.paymentPending || 0))
    ) || 0;
    if (paid + advanceApplied > 0 || settlementPending > 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot return a bill that already has payment / advance settlement recorded or pending'
      });
    }

    const reason = String(req.body?.rejectionReason || req.body?.reason || req.body?.comments || '').trim();
    if (!reason) {
      return res.status(400).json({ success: false, message: 'Return / rejection reason is required' });
    }

    const userId = req.user.id || req.user._id;
    const fromStatus = bill.status;
    // Do NOT touch approvalStatus or approvalChain — authorities remain intact
    bill.workflowHistory = Array.isArray(bill.workflowHistory) ? bill.workflowHistory : [];
    bill.workflowHistory.push({
      fromStatus,
      toStatus: 'Returned from Finance',
      changedBy: userId,
      changedAt: new Date(),
      comments: `Returned to initiator: ${reason}`,
      module: 'Finance'
    });
    bill.observations = Array.isArray(bill.observations) ? bill.observations : [];
    bill.observations.push({
      observation: reason,
      severity: 'medium',
      addedBy: userId,
      addedAt: new Date(),
      resolved: false
    });
    bill.status = 'Returned from Finance';
    bill.lastModifiedBy = userId;
    await bill.save();

    // Notify initiator (createdBy)
    try {
      const initiatorId = bill.createdBy ? String(bill.createdBy) : null;
      if (initiatorId) {
        const { createAndEmitNotification } = require('../services/realtimeNotificationService');
        await createAndEmitNotification({
          recipientIds: [initiatorId],
          title: 'Vendor bill returned by Finance',
          message: `Bill ${bill.billNumber || bill._id} was returned for correction: ${reason}`,
          type: 'warning',
          category: 'approval',
          priority: 'high',
          actionUrl: '/finance/accounts-payable',
          createdBy: userId,
          excludeUserId: userId,
          metadata: {
            module: 'finance',
            entityId: bill._id,
            entityType: 'AccountsPayable',
            queueStage: 'returned_from_finance'
          }
        });
      }
    } catch (notifyErr) {
      console.warn('finance-return notify warning:', notifyErr.message);
    }

    const populated = await AccountsPayable.findById(bill._id)
      .populate('createdBy', 'firstName lastName email')
      .populate('approvalChain.approver', 'firstName lastName email employeeId digitalSignature')
      .populate('observations.addedBy', 'firstName lastName email');

    res.json({
      success: true,
      message: 'Bill returned to initiator. Department approval remains intact.',
      data: populated
    });
  })
);

// @route   POST /api/finance/accounts-payable/:id/resubmit-to-finance
// @desc    Initiator resubmits bill after Finance return → back to Finance (approved), no dept re-approval
// @access  Private (initiator or Finance)
router.post('/accounts-payable/:id/resubmit-to-finance',
  authorize('super_admin', 'admin', 'finance_manager', 'general_manager', 'procurement_manager'),
  asyncHandler(async (req, res) => {
    const bill = await AccountsPayable.findById(req.params.id);
    if (!bill) {
      return res.status(404).json({ success: false, message: 'Bill not found' });
    }
    if (bill.status !== 'Returned from Finance') {
      return res.status(400).json({
        success: false,
        message: 'Only bills returned from Finance can be resubmitted'
      });
    }

    const userId = req.user.id || req.user._id;
    const role = String(req.user.role || '');
    const isFinanceRole = ['super_admin', 'admin', 'finance_manager', 'general_manager'].includes(role);
    const isInitiator = String(bill.createdBy || '') === String(userId);
    if (!isInitiator && !isFinanceRole) {
      return res.status(403).json({
        success: false,
        message: 'Only the bill initiator (or Finance) can resubmit this bill'
      });
    }

    const comments = String(req.body?.comments || '').trim() || 'Resubmitted to Finance after corrections';
    bill.workflowHistory = Array.isArray(bill.workflowHistory) ? bill.workflowHistory : [];
    bill.workflowHistory.push({
      fromStatus: 'Returned from Finance',
      toStatus: 'approved',
      changedBy: userId,
      changedAt: new Date(),
      comments,
      module: 'Finance'
    });
    // Mark open finance-return observations resolved
    if (Array.isArray(bill.observations)) {
      bill.observations.forEach((obs) => {
        if (obs && !obs.resolved) obs.resolved = true;
      });
    }
    bill.status = 'approved';
    bill.lastModifiedBy = userId;
    await bill.save();

    const populated = await AccountsPayable.findById(bill._id)
      .populate('createdBy', 'firstName lastName email')
      .populate('approvalChain.approver', 'firstName lastName email employeeId digitalSignature')
      .populate('observations.addedBy', 'firstName lastName email');

    res.json({
      success: true,
      message: 'Bill resubmitted to Finance successfully (approval authorities unchanged)',
      data: populated
    });
  })
);

// @route   DELETE /api/finance/accounts-payable/:id
// @desc    Delete a bill from accounts payable
// @access  Private (Finance and Admin)
router.delete('/accounts-payable/:id',
  authorize('super_admin', 'admin', 'finance_manager', 'general_manager'),
  asyncHandler(async (req, res) => {
    const bill = await AccountsPayable.findById(req.params.id);
    if (!bill) {
      return res.status(404).json({
        success: false,
        message: 'Bill not found'
      });
    }

    if (bill.amountPaid > 0 || (bill.payments && bill.payments.length > 0)) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete a bill that has recorded payments. Please void/remove payments first.'
      });
    }

    // Clean up Journal Entries associated with this bill
    try {
      await JournalEntry.deleteMany({
        $or: [
          { referenceId: bill._id },
          { 'sourceDocument.id': bill._id },
          { narration: { $regex: bill.billNumber, $options: 'i' } }
        ]
      });
    } catch (jErr) {
      console.warn('Could not clean up journal entries for deleted bill', jErr);
    }

    // If linked to utility bill, remove or update
    if (bill.referenceType === 'utility_bill' && bill.referenceId) {
      try {
        await UtilityBill.findByIdAndUpdate(bill.referenceId, {
          $set: { status: 'Draft' }
        });
      } catch (uErr) {
        console.warn('Could not update linked utility bill', uErr);
      }
    }

    await AccountsPayable.findByIdAndDelete(req.params.id);

    res.json({
      success: true,
      message: `Bill ${bill.billNumber} deleted successfully`
    });
  })
);

// ================================
// BANKING ROUTES
// ================================

// @route   GET /api/finance/banking/accounts
// @desc    Get all bank accounts
// @access  Private (Finance and Admin)
router.get('/banking/accounts', 
  authorize('super_admin', 'admin', 'finance_manager'), 
  asyncHandler(async (req, res) => {
    const { 
      page = 1, 
      limit = 20, 
      accountType,
      department,
      isActive,
      search 
    } = req.query;

    const { q } = await financeScope(req);
    const filters = q({});

    if (accountType) filters.accountType = accountType;
    if (department) filters.department = department;
    if (isActive !== undefined) filters.isActive = isActive === 'true';
    if (search) {
      filters.$or = [
        { accountName: { $regex: search, $options: 'i' } },
        { accountNumber: { $regex: search, $options: 'i' } },
        { bankName: { $regex: search, $options: 'i' } }
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    const [accounts, totalCount] = await Promise.all([
      Banking.find(filters)
        .sort({ accountName: 1 })
        .skip(skip)
        .limit(parseInt(limit)),
      Banking.countDocuments(filters)
    ]);

    const totalPages = Math.ceil(totalCount / parseInt(limit));

    res.json({
      success: true,
      data: {
        accounts,
        pagination: {
          currentPage: parseInt(page),
          totalPages,
          totalCount,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1,
          limit: parseInt(limit)
        }
      }
    });
  })
);

// @route   GET /api/finance/banking
// @desc    Get all bank accounts (alias for /banking/accounts)
// @access  Private (Finance and Admin)
router.get('/banking', 
  authorize('super_admin', 'admin', 'finance_manager'), 
  asyncHandler(async (req, res) => {
    const { 
      page = 1, 
      limit = 20, 
      accountType,
      department,
      isActive,
      search 
    } = req.query;

    const { q } = await financeScope(req);
    const filters = q({});

    if (accountType) filters.accountType = accountType;
    if (department) filters.department = department;
    if (isActive !== undefined) filters.isActive = isActive === 'true';
    if (search) {
      filters.$or = [
        { accountName: { $regex: search, $options: 'i' } },
        { accountNumber: { $regex: search, $options: 'i' } },
        { bankName: { $regex: search, $options: 'i' } }
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    const [accounts, totalCount] = await Promise.all([
      Banking.find(filters)
        .sort({ accountName: 1 })
        .skip(skip)
        .limit(parseInt(limit))
        .populate('createdBy', 'firstName lastName')
        .exec(),
      Banking.countDocuments(filters)
    ]);

    const summary = await Banking.getAccountSummary(q({}));

    res.json({
      success: true,
      data: {
        accounts,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(totalCount / parseInt(limit)),
          totalCount,
          hasNextPage: page < Math.ceil(totalCount / parseInt(limit)),
          hasPrevPage: page > 1,
          limit: parseInt(limit)
        },
        summary
      }
    });
  })
);

// @route   GET /api/finance/banking/transactions
// @desc    Get reconciled / cleared banking transactions with complete accounting breakdown
// @access  Private (Finance and Admin)
router.get('/banking/transactions', 
  authorize('super_admin', 'admin', 'finance_manager'), 
  asyncHandler(async (req, res) => {
    const { 
      page = 1, 
      limit = 50,
      accountId,
      bankAccount,
      startDate,
      endDate,
      search,
      companyId,
      project
    } = req.query;

    const { q, companyId: scopedCompanyId } = await financeScope(req);
    const effectiveCompanyId = companyId || scopedCompanyId;

    // 1. Identify Target Bank Accounts (COA)
    let targetAccountIds = [];
    if (accountId || bankAccount) {
      const selectedAccId = accountId || bankAccount;
      const selectedAccountObj = await Account.findById(selectedAccId).lean();
      if (selectedAccountObj) {
        const allCompanyAccounts = await Account.find({
          ...(selectedAccountObj.companyId ? { companyId: selectedAccountObj.companyId } : {})
        }).lean();

        const findChildren = (parentId) => {
          let ids = [parentId];
          const directKids = allCompanyAccounts.filter((a) => String(a.parentAccount || '') === String(parentId));
          directKids.forEach((child) => {
            ids = ids.concat(findChildren(child._id));
          });
          return ids;
        };

        targetAccountIds = findChildren(selectedAccountObj._id);
      } else {
        targetAccountIds = [selectedAccId];
      }
    } else {
      const companyAccFilter = (effectiveCompanyId && effectiveCompanyId !== 'all')
        ? { $or: [{ companyId: effectiveCompanyId }, { companyId: null }, { companyId: { $exists: false } }] }
        : {};
      const bankAccounts = await Account.find({
        ...companyAccFilter,
        type: 'Asset',
        $or: [
          { category: { $regex: /cash|bank/i } },
          { detailType: { $regex: /cash|bank/i } },
          { accountType: { $regex: /cash|bank/i } },
          { accountCode: 'BANK' },
          { accountCode: 'CASH' }
        ]
      }).select('_id').lean();
      targetAccountIds = bankAccounts.map(a => a._id);
    }

    // 2. Query GeneralLedger where transaction is cleared / reconciled
    const glQuery = {
      account: { $in: targetAccountIds },
      $or: [
        { clearanceStatus: 'cleared' },
        { isReconciled: true }
      ]
    };

    if (effectiveCompanyId && effectiveCompanyId !== 'all') {
      glQuery.companyId = effectiveCompanyId;
    }

    if (startDate || endDate) {
      glQuery.$and = glQuery.$and || [];
      if (startDate) {
        const s = new Date(startDate);
        s.setHours(0, 0, 0, 0);
        glQuery.$and.push({
          $or: [
            { clearedAt: { $gte: s } },
            { reconciledAt: { $gte: s } },
            { date: { $gte: s } }
          ]
        });
      }
      if (endDate) {
        const e = new Date(endDate);
        e.setHours(23, 59, 59, 999);
        glQuery.$and.push({
          $or: [
            { clearedAt: { $lte: e } },
            { reconciledAt: { $lte: e } },
            { date: { $lte: e } }
          ]
        });
      }
    }

    const glEntries = await GeneralLedger.find(glQuery)
      .populate('account', 'name accountNumber category detailType type')
      .populate('costCenter', 'name code')
      .populate('companyId', 'name companyCode')
      .populate({
        path: 'journalEntry',
        select: 'status isReconciled reconciledAt clearanceStatus clearedAt signedDocumentStatus signedDocumentAt signedBySignatory attachments entryNumber reference description lines date project companyId customPaymentType customMainAccountHead customSubAccountHead customCompany customProject',
        populate: [
          { path: 'lines.account', select: 'name accountNumber category detailType type' },
          { path: 'lines.costCenter', select: 'name code' },
          { path: 'project', select: 'name code' },
          { path: 'companyId', select: 'name companyCode' }
        ]
      })
      .sort({ clearedAt: -1, date: -1, entryNumber: -1 })
      .lean();

    const transactions = [];
    const seenTxnKeys = new Set();

    glEntries.forEach((gle) => {
      const je = gle.journalEntry || {};
      const txnKey = `${gle._id}`;
      if (seenTxnKeys.has(txnKey)) return;
      seenTxnKeys.add(txnKey);

      // In bank ledger: debit = cash in (Dr), credit = cash out (Cr)
      const isCredit = (Number(gle.credit) || 0) > 0;
      const amt = isCredit ? Number(gle.credit) : Number(gle.debit);
      const clearDate = gle.clearedAt || je.clearedAt || gle.reconciledAt || je.reconciledAt || gle.date;

      // Find the corresponding opposing line for description/heads
      let opposingLine = null;
      if (je && Array.isArray(je.lines) && je.lines.length > 0) {
        opposingLine = je.lines.find((line) => {
          const lineAccId = String(line.account?._id || line.account || '');
          const bankAccId = String(gle.account?._id || gle.account || '');
          return lineAccId !== bankAccId;
        }) || je.lines[0];
      }

      const mainAccountHead = je.customMainAccountHead || opposingLine?.account?.category || opposingLine?.account?.type || opposingLine?.account?.name || 'General';
      const subAccountHead = je.customSubAccountHead || opposingLine?.account?.name || opposingLine?.description || '—';
      const companyName = je.customCompany || gle.companyId?.companyCode || gle.companyId?.name || je.companyId?.companyCode || je.companyId?.name || '—';
      const projectName = je.customProject || je.project?.name || je.project?.code || '—';
      const costCenterName = gle.costCenter?.name || opposingLine?.costCenter?.name || '—';
      const paymentType = je.customPaymentType || (je.voucherSeries ? String(je.voucherSeries).toUpperCase() : (isCredit ? 'Payment' : 'Receipt'));

      transactions.push({
        _id: gle._id,
        journalEntryId: je._id || null,
        vDate: gle.date,
        vNo: gle.entryNumber || je.entryNumber || '—',
        narration: gle.description || je.description || 'Bank Transaction',
        instNo: gle.reference || je.reference || '—',
        amount: amt,
        drCr: isCredit ? 'Cr' : 'Dr',
        displayAmount: isCredit ? -amt : amt,
        clearingDate: clearDate,
        bank: gle.account?.name || 'Bank Account',
        bankAccountNumber: gle.account?.accountNumber || '',
        paymentType,
        mainAccountHead,
        subAccountHead,
        companies: companyName,
        project: projectName,
        costCenter: costCenterName,
        signedBy: je.signedBySignatory || '—',
        signedDate: je.signedDocumentAt || null,
        status: 'Cleared'
          });
        });

    // Also check Journal Entries directly with clearanceStatus === 'cleared' that might not be in GL
    const jeDirectQuery = q({
      clearanceStatus: 'cleared',
      'lines.account': { $in: targetAccountIds }
    });

    if (effectiveCompanyId && effectiveCompanyId !== 'all') {
      jeDirectQuery.companyId = effectiveCompanyId;
    }

    if (startDate || endDate) {
      jeDirectQuery.$and = jeDirectQuery.$and || [];
      if (startDate) {
        const s = new Date(startDate);
        s.setHours(0, 0, 0, 0);
        jeDirectQuery.$and.push({
          $or: [
            { clearedAt: { $gte: s } },
            { date: { $gte: s } }
          ]
        });
      }
      if (endDate) {
        const e = new Date(endDate);
        e.setHours(23, 59, 59, 999);
        jeDirectQuery.$and.push({
          $or: [
            { clearedAt: { $lte: e } },
            { date: { $lte: e } }
          ]
        });
      }
    }

    const directJes = await JournalEntry.find(jeDirectQuery)
      .populate('lines.account', 'name accountNumber category detailType type')
      .populate('lines.costCenter', 'name code')
      .populate('project', 'name code')
      .populate('companyId', 'name companyCode')
      .sort({ clearedAt: -1, date: -1 })
      .lean();

    const targetAccountIdsSet = new Set(targetAccountIds.map(id => String(id)));

    directJes.forEach((je) => {
      // Only check if this journalEntry hasn't already been covered by GeneralLedger entries
      const alreadyInGl = glEntries.some(gle => gle.journalEntry && String(gle.journalEntry._id || gle.journalEntry) === String(je._id));
      if (alreadyInGl) return;

      (je.lines || []).forEach((line, idx) => {
        const lineAccId = String(line.account?._id || line.account || '');
        if (targetAccountIdsSet.has(lineAccId)) {
          const isCredit = (Number(line.credit) || 0) > 0;
          const amt = isCredit ? Number(line.credit) : Number(line.debit);
          const clearDate = je.clearedAt || je.reconciledAt || je.date;

          const opposing = je.lines.find((l, i) => i !== idx) || line;
          const mainAccountHead = je.customMainAccountHead || opposing?.account?.category || opposing?.account?.type || opposing?.account?.name || 'General';
          const subAccountHead = je.customSubAccountHead || opposing?.account?.name || opposing?.description || '—';
          const companyName = je.customCompany || je.companyId?.companyCode || je.companyId?.name || '—';
          const projectName = je.customProject || je.project?.name || je.project?.code || '—';
          const costCenterName = line.costCenter?.name || opposing?.costCenter?.name || '—';
          const paymentType = je.customPaymentType || (je.voucherSeries ? String(je.voucherSeries).toUpperCase() : (isCredit ? 'Payment' : 'Receipt'));

          const lineKey = `${je._id}-${idx}`;
          if (!seenTxnKeys.has(lineKey)) {
            seenTxnKeys.add(lineKey);
            transactions.push({
              _id: lineKey,
              journalEntryId: je._id,
              vDate: je.date,
              vNo: je.entryNumber || je.reference || '—',
              narration: line.description || je.description || 'Bank Transaction',
              instNo: je.reference || je.entryNumber || '—',
              amount: amt,
              drCr: isCredit ? 'Cr' : 'Dr',
              displayAmount: isCredit ? -amt : amt,
              clearingDate: clearDate,
              bank: line.account?.name || 'Bank Account',
              bankAccountNumber: line.account?.accountNumber || '',
              paymentType,
              mainAccountHead,
              subAccountHead,
              companies: companyName,
              project: projectName,
              costCenter: costCenterName,
              signedBy: je.signedBySignatory || '—',
              signedDate: je.signedDocumentAt || null,
              status: 'Cleared'
            });
          }
        }
        });
      });

    // Apply keyword search
    let filtered = transactions;
    if (search && search.trim()) {
      const s = search.trim().toLowerCase();
      filtered = filtered.filter(t =>
        (t.vNo && t.vNo.toLowerCase().includes(s)) ||
        (t.narration && t.narration.toLowerCase().includes(s)) ||
        (t.instNo && t.instNo.toLowerCase().includes(s)) ||
        (t.bank && t.bank.toLowerCase().includes(s)) ||
        (t.paymentType && t.paymentType.toLowerCase().includes(s)) ||
        (t.mainAccountHead && t.mainAccountHead.toLowerCase().includes(s)) ||
        (t.subAccountHead && t.subAccountHead.toLowerCase().includes(s)) ||
        (t.companies && t.companies.toLowerCase().includes(s)) ||
        (t.project && t.project.toLowerCase().includes(s))
      );
    }

    // Sort by clearingDate (newest first)
    filtered.sort((a, b) => new Date(b.clearingDate || b.vDate) - new Date(a.clearingDate || a.vDate));

    // Summary calculation
    const totalDr = filtered.filter(t => t.drCr === 'Dr').reduce((s, t) => s + t.amount, 0);
    const totalCr = filtered.filter(t => t.drCr === 'Cr').reduce((s, t) => s + t.amount, 0);
    const netBalance = totalDr - totalCr;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const paginatedTransactions = filtered.slice(skip, skip + parseInt(limit));
    const totalCount = filtered.length;

    res.json({
      success: true,
      data: {
        transactions: paginatedTransactions,
        summary: {
          totalCount,
          totalDr: Math.round(totalDr * 100) / 100,
          totalCr: Math.round(totalCr * 100) / 100,
          netBalance: Math.round(netBalance * 100) / 100,
          netBalanceType: netBalance >= 0 ? 'Dr' : 'Cr'
        },
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(totalCount / parseInt(limit)) || 1,
          totalCount,
          hasNextPage: page < Math.ceil(totalCount / parseInt(limit)),
          hasPrevPage: page > 1,
          limit: parseInt(limit)
        }
      }
    });
  })
);

// @route   PUT /api/finance/banking/transactions/:id/custom-meta
// @desc    Update editable custom metadata fields for a banking entry (Main Head, Sub Head, Company, Project, Payment Type)
// @access  Private (Finance and Admin)
router.put('/banking/transactions/:id/custom-meta',
  authorize('super_admin', 'admin', 'finance_manager'),
  asyncHandler(async (req, res) => {
    const {
      journalEntryId,
      customPaymentType,
      customMainAccountHead,
      customSubAccountHead,
      customCompany,
      customProject
    } = req.body || {};

    const targetJeId = journalEntryId || req.params.id;
    const entry = await JournalEntry.findById(targetJeId);
    if (!entry) {
      return res.status(404).json({ success: false, message: 'Journal entry / voucher not found' });
    }

    if (customPaymentType !== undefined) entry.customPaymentType = customPaymentType;
    if (customMainAccountHead !== undefined) entry.customMainAccountHead = customMainAccountHead;
    if (customSubAccountHead !== undefined) entry.customSubAccountHead = customSubAccountHead;
    if (customCompany !== undefined) entry.customCompany = customCompany;
    if (customProject !== undefined) entry.customProject = customProject;

    await entry.save();

    res.json({
      success: true,
      message: 'Custom banking attributes updated successfully',
      data: {
        _id: entry._id,
        customPaymentType: entry.customPaymentType,
        customMainAccountHead: entry.customMainAccountHead,
        customSubAccountHead: entry.customSubAccountHead,
        customCompany: entry.customCompany,
        customProject: entry.customProject
      }
    });
  })
);

// @route   GET /api/finance/banking/summary
// @desc    Get banking summary
// @access  Private (Finance and Admin)
router.get('/banking/summary', 
  authorize('super_admin', 'admin', 'finance_manager'), 
  asyncHandler(async (req, res) => {
    const { q } = await financeScope(req);
    const summary = await Banking.getAccountSummary(q({}));
    res.json({
      success: true,
      data: summary
    });
  })
);

// @route   POST /api/finance/banking
// @desc    Create new bank account
// @access  Private (Finance and Admin)
router.post('/banking',
  authorize('super_admin', 'admin', 'finance_manager'),
  [
    body('accountName').trim().notEmpty().withMessage('Account name is required'),
    body('accountNumber').trim().notEmpty().withMessage('Account number is required'),
    body('bankName').trim().notEmpty().withMessage('Bank name is required'),
    body('accountType').isIn(['checking', 'savings', 'money_market', 'cd', 'line_of_credit', 'credit_card']).withMessage('Valid account type is required')
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      console.error("Journal Entry Validation Error (PUT):", JSON.stringify(errors.array(), null, 2));
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array(),
        errors: errors.array()
      });
    }

    const { companyId } = await financeScope(req);
    const accountData = {
      ...req.body,
      createdBy: req.user._id,
      companyId
    };

    const account = new Banking(accountData);
    await account.save();

    res.status(201).json({
      success: true,
      message: 'Bank account created successfully',
      data: account
    });
  })
);

// ================================
// FINANCIAL REPORTS ROUTES
// ================================

// @route   GET /api/finance/reports
// @desc    Get financial reports (unified endpoint)
// @access  Private (Finance and Admin)
router.get('/reports', 
  authorize('super_admin', 'admin', 'finance_manager'), 
  asyncHandler(async (req, res) => {
    const { reportType = 'overview', startDate, endDate, department } = req.query;
    
    try {
      let reportData = {};
      
      if (reportType === 'overview') {
        // Calculate date range
        const start = startDate ? new Date(startDate) : new Date(new Date().getFullYear(), 0, 1);
        const end = endDate ? new Date(endDate) : new Date();
        
        // Get all accounts
        const [revenueAccounts, expenseAccounts, cashAccounts] = await Promise.all([
          Account.find({ type: 'Revenue', isActive: true }),
          Account.find({ type: 'Expense', isActive: true }),
          Account.find({ type: 'Asset', category: 'Cash', isActive: true })
        ]);

        // Calculate period balances
        const calculatePeriodBalance = async (accountId, startDate, endDate) => {
          const ledgerEntries = await GeneralLedger.find({
            account: accountId,
            date: { $gte: startDate, $lte: endDate },
            status: 'posted'
          });
          
          let balance = 0;
          ledgerEntries.forEach(entry => {
            balance += entry.debit - entry.credit;
          });
          return balance;
        };

        // Calculate revenue
        let totalRevenue = 0;
        const departmentBreakdown = {};
        
        for (const account of revenueAccounts) {
          const balance = await calculatePeriodBalance(account._id, start, end);
          totalRevenue += Math.abs(balance);
          
          const dept = account.department || 'general';
          if (!departmentBreakdown[dept]) {
            departmentBreakdown[dept] = { revenue: 0, expenses: 0, netProfit: 0 };
          }
          departmentBreakdown[dept].revenue += Math.abs(balance);
        }

        // Calculate expenses
        let totalExpenses = 0;
        for (const account of expenseAccounts) {
          const balance = await calculatePeriodBalance(account._id, start, end);
          totalExpenses += Math.abs(balance);
          
          const dept = account.department || 'general';
          if (!departmentBreakdown[dept]) {
            departmentBreakdown[dept] = { revenue: 0, expenses: 0, netProfit: 0 };
          }
          departmentBreakdown[dept].expenses += Math.abs(balance);
        }

        // Calculate department net profit
        Object.keys(departmentBreakdown).forEach(dept => {
          departmentBreakdown[dept].netProfit = 
            departmentBreakdown[dept].revenue - departmentBreakdown[dept].expenses;
        });

        // Calculate cash balance
        let cashBalance = 0;
        for (const account of cashAccounts) {
          cashBalance += account.balance;
        }

        reportData = {
          totalRevenue,
          totalExpenses,
          netProfit: totalRevenue - totalExpenses,
          cashBalance,
          departmentBreakdown
        };
      } 
      else if (reportType === 'profit-loss') {
        const start = startDate ? new Date(startDate) : new Date(new Date().getFullYear(), 0, 1);
        const end = endDate ? new Date(endDate) : new Date();
        
        const [revenueAccounts, expenseAccounts] = await Promise.all([
          Account.find({ type: 'Revenue', isActive: true }),
          Account.find({ type: 'Expense', isActive: true })
        ]);

        const profitLossData = [];
        
        // Add revenue items
        for (const account of revenueAccounts) {
          const ledgerEntries = await GeneralLedger.find({
            account: account._id,
            date: { $gte: start, $lte: end },
            status: 'posted'
          });
          
          let amount = 0;
          ledgerEntries.forEach(entry => {
            amount += entry.credit - entry.debit;
          });
          
          if (amount !== 0) {
            profitLossData.push({
              name: account.name,
              category: account.category,
              department: account.department,
              type: 'revenue',
              amount: Math.abs(amount)
            });
          }
        }
        
        // Add expense items
        for (const account of expenseAccounts) {
          const ledgerEntries = await GeneralLedger.find({
            account: account._id,
            date: { $gte: start, $lte: end },
            status: 'posted'
          });
          
          let amount = 0;
          ledgerEntries.forEach(entry => {
            amount += entry.debit - entry.credit;
          });
          
          if (amount !== 0) {
            profitLossData.push({
              name: account.name,
              category: account.category,
              department: account.department,
              type: 'expense',
              amount: Math.abs(amount)
            });
          }
        }
        
        reportData = { profitLossData };
      }
      else if (reportType === 'balance-sheet') {
        const asOf = endDate ? new Date(endDate) : new Date();
        
        const [assets, liabilities] = await Promise.all([
          Account.find({ type: 'Asset', isActive: true }),
          Account.find({ type: 'Liability', isActive: true })
        ]);

        const assetData = [];
        const liabilityData = [];
        
        for (const account of assets) {
          if (account.balance !== 0) {
            assetData.push({
              name: account.name,
              balance: account.balance
            });
          }
        }
        
        for (const account of liabilities) {
          if (account.balance !== 0) {
            liabilityData.push({
              name: account.name,
              balance: account.balance
            });
          }
        }
        
        reportData = {
          balanceSheetData: {
            assets: assetData,
            liabilities: liabilityData
          }
        };
      }
      
      res.json({
        success: true,
        data: reportData
      });
    } catch (error) {
      console.error('Error generating financial report:', error);
      res.status(500).json({
        success: false,
        message: 'Error generating financial report',
        error: error.message
      });
    }
  })
);

// @route   GET /api/finance/reports/trial-balance
// @desc    Get trial balance report
// @access  Private (Finance and Admin)
router.get('/reports/trial-balance', 
  authorize('super_admin', 'admin', 'finance_manager'), 
  asyncHandler(async (req, res) => {
    const { asOfDate } = req.query;
    const trialBalance = await JournalEntry.getTrialBalance(asOfDate ? new Date(asOfDate) : new Date());
    res.json({
      success: true,
      data: trialBalance
    });
  })
);

// NOTE: Balance Sheet, Profit & Loss, and Cash Flow routes are defined further below
// using JournalEntry aggregation for accurate GL-sourced data.

// ================================
// INVENTORY VALUATION REPORT
// ================================

// @route   GET /api/finance/reports/inventory-valuation
// @desc    Inventory valuation using Weighted Average Cost
//          Shows each item: qty × WAC = total value, grouped by category
// @access  Private (Finance and Admin)
router.get('/reports/inventory-valuation',
  authorize('super_admin', 'admin', 'finance_manager'),
  asyncHandler(async (req, res) => {
    const Inventory = require('../models/procurement/Inventory');
    const InventoryCategory = require('../models/procurement/InventoryCategory');

    const { categoryId, search } = req.query;
    const query = { quantity: { $gt: 0 } };
    if (categoryId) query.inventoryCategory = categoryId;
    if (search) query.$or = [
      { name: { $regex: search, $options: 'i' } },
      { itemCode: { $regex: search, $options: 'i' } }
    ];

    const items = await Inventory.find(query)
      .populate('inventoryCategory', 'name')
      .populate('inventoryAccount', 'accountNumber name')
      .select('itemCode name category inventoryCategory quantity unitPrice averageCost totalValue inventoryAccount store storeSnapshot')
      .lean();

    // Build report with WAC-based values
    const reportItems = items.map(item => {
      const wac = item.averageCost || item.unitPrice || 0;
      const qty = item.quantity || 0;
      return {
        itemCode: item.itemCode,
        name: item.name,
        category: item.inventoryCategory?.name || item.category || '—',
        store: item.storeSnapshot || '—',
        quantity: qty,
        unitPrice: item.unitPrice || 0,
        weightedAverageCost: wac,
        totalValue: Math.round(qty * wac * 100) / 100,
        inventoryAccount: item.inventoryAccount
          ? `${item.inventoryAccount.accountNumber} – ${item.inventoryAccount.name}`
          : '—'
      };
    });

    // Group by category
    const byCategory = {};
    for (const item of reportItems) {
      const cat = item.category;
      if (!byCategory[cat]) byCategory[cat] = { name: cat, items: [], totalValue: 0, totalQty: 0 };
      byCategory[cat].items.push(item);
      byCategory[cat].totalValue = Math.round((byCategory[cat].totalValue + item.totalValue) * 100) / 100;
      byCategory[cat].totalQty += item.quantity;
    }

    const grandTotal = reportItems.reduce((s, i) => s + i.totalValue, 0);

    // Compare with GL balance on inventory accounts
    const inventoryGLBalance = await GeneralLedger.aggregate([
      {
        $lookup: {
          from: 'accounts',
          localField: 'account',
          foreignField: '_id',
          as: 'accountDoc'
        }
      },
      { $unwind: '$accountDoc' },
      {
        $match: {
          'accountDoc.type': 'Asset',
          'accountDoc.accountNumber': { $regex: /^11/ }, // 1100-1199 inventory range
          status: 'posted'
        }
      },
      {
        $group: {
          _id: null,
          totalDebit: { $sum: '$debit' },
          totalCredit: { $sum: '$credit' }
        }
      }
    ]);

    const glBalance = inventoryGLBalance[0]
      ? Math.round((inventoryGLBalance[0].totalDebit - inventoryGLBalance[0].totalCredit) * 100) / 100
      : null;

    res.json({
      success: true,
      data: {
        generatedAt: new Date(),
        items: reportItems,
        byCategory: Object.values(byCategory),
        summary: {
          totalItems: reportItems.length,
          grandTotalValue: Math.round(grandTotal * 100) / 100,
          glInventoryBalance: glBalance,
          variance: glBalance !== null ? Math.round((grandTotal - glBalance) * 100) / 100 : null
        }
      }
    });
  })
);

// ================================
// TRIAL BALANCE — SINGLE SOURCE OF TRUTH
// ================================

// @route   GET /api/finance/reports/trial-balance-v2
// @desc    Trial balance computed ONLY from posted journal entry lines (single source of truth)
//          Fixes the two-implementation inconsistency — do NOT use Account.balance field for reporting
// @access  Private
router.get('/reports/trial-balance-v2',
  authorize('super_admin', 'admin', 'finance_manager'),
  asyncHandler(async (req, res) => {
    const round2 = (n) => Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100;
    const { asOfDate, fromDate } = req.query;
    const asOf = asOfDate ? new Date(asOfDate) : new Date();
    // For date-only filters, include the full day so same-day posted entries
    // (with non-midnight timestamps) are not accidentally excluded.
    if (asOfDate) asOf.setHours(23, 59, 59, 999);

    const from = fromDate ? new Date(fromDate) : new Date(asOf.getFullYear(), 0, 1);
    from.setHours(0, 0, 0, 0);

    let company = null;
    try {
      company = await requireCompanyFromRequest(req);
    } catch (err) {
      company = await findHistoricalCompany();
      if (!company) throw err;
    }
    const companyMatch = company?._id ? { companyId: company._id } : {};

    // Opening = balance before period start
    const openingRows = await JournalEntry.aggregate([
      { $match: { status: 'posted', date: { $lt: from }, ...companyMatch } },
      { $unwind: '$lines' },
      {
        $group: {
          _id: '$lines.account',
          openingDebit: { $sum: '$lines.debit' },
          openingCredit: { $sum: '$lines.credit' }
        }
      },
      {
        $project: {
          openingBalance: { $subtract: ['$openingDebit', '$openingCredit'] }
        }
      }
    ]);

    // Movement = debit/credit within selected period
    const movementRows = await JournalEntry.aggregate([
      { $match: { status: 'posted', date: { $gte: from, $lte: asOf }, ...companyMatch } },
      { $unwind: '$lines' },
      {
        $group: {
          _id: '$lines.account',
          totalDebit: { $sum: '$lines.debit' },
          totalCredit: { $sum: '$lines.credit' }
        }
      }
    ]);

    const openingByAccount = new Map(openingRows.map((r) => [String(r._id), r.openingBalance || 0]));
    const movementByAccount = new Map(
      movementRows.map((r) => [String(r._id), { totalDebit: r.totalDebit || 0, totalCredit: r.totalCredit || 0 }])
    );

    const accountIds = Array.from(
      new Set([...openingByAccount.keys(), ...movementByAccount.keys()])
    );
    const accounts = await Account.find({ _id: { $in: accountIds } })
      .select('accountNumber name type')
      .lean();

    const rows = accounts
      .map((acc) => {
        const accountId = String(acc._id);
        const openingBalance = round2(openingByAccount.get(accountId) || 0);
        const movement = movementByAccount.get(accountId) || { totalDebit: 0, totalCredit: 0 };
        const totalDebit = round2(movement.totalDebit);
        const totalCredit = round2(movement.totalCredit);
        const closingBalance = round2(openingBalance + totalDebit - totalCredit);
        return {
          _id: acc._id,
          accountNumber: acc.accountNumber,
          accountName: acc.name,
          accountType: acc.type,
          openingBalance,
          totalDebit,
          totalCredit,
          closingBalance,
          netBalance: closingBalance
        };
      })
      .sort((a, b) => String(a.accountNumber || '').localeCompare(String(b.accountNumber || '')));

    const totalDebits = round2(rows.reduce((s, r) => s + r.totalDebit, 0));
    const totalCredits = round2(rows.reduce((s, r) => s + r.totalCredit, 0));

    res.json({
      success: true,
      data: {
        company: company
          ? { _id: company._id, name: company.name, companyCode: company.companyCode }
          : null,
        fromDate: from,
        asOfDate: asOf,
        rows,
        totals: {
          totalDebits,
          totalCredits,
          isBalanced: Math.abs(totalDebits - totalCredits) < 0.01
        }
      }
    });
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// FINANCE VENDOR DIRECTORY (master + AP summary)
// ─────────────────────────────────────────────────────────────────────────────

const collectVendorJournalEntryIds = async (vendorObjectId, companyId) => {
  const mongoose = require('mongoose');
  const UtilityBill = require('../models/hr/UtilityBill');
  const PurchaseOrder = require('../models/procurement/PurchaseOrder');
  const GoodsReceive = require('../models/procurement/GoodsReceive');
  const coFilter = companyId ? { companyId } : {};
  const vendorOid = mongoose.Types.ObjectId.isValid(String(vendorObjectId))
    ? new mongoose.Types.ObjectId(vendorObjectId)
    : null;
  if (!vendorOid) return [];

  const [apIds, advanceIds, utilityBills, poIds, grnIds] = await Promise.all([
    AccountsPayable.find({ 'vendor.vendorId': vendorOid, ...coFilter }).distinct('_id'),
    VendorAdvance.find({ 'vendor.vendorId': vendorOid, ...coFilter }).distinct('_id'),
    UtilityBill.find({ vendorId: vendorOid }).select('_id financeApBillId').lean(),
    PurchaseOrder.find({ vendor: vendorOid }).distinct('_id'),
    GoodsReceive.find({ supplier: vendorOid }).distinct('_id')
  ]);

  const referenceIdSet = new Set();
  const addRef = (id) => {
    if (id) referenceIdSet.add(String(id));
  };
  apIds.forEach(addRef);
  advanceIds.forEach(addRef);
  poIds.forEach(addRef);
  grnIds.forEach(addRef);
  utilityBills.forEach((b) => {
    addRef(b._id);
    addRef(b.financeApBillId);
  });

  const referenceIds = [...referenceIdSet]
    .filter((id) => mongoose.Types.ObjectId.isValid(id))
    .map((id) => new mongoose.Types.ObjectId(id));

  const jeIdSet = new Set();
  const jeBase = { status: 'posted', ...coFilter };

  if (referenceIds.length) {
    const fromRefs = await JournalEntry.find({
      ...jeBase,
      referenceId: { $in: referenceIds }
  }).distinct('_id');
    fromRefs.forEach((id) => jeIdSet.add(String(id)));
  }

  // Manual journal lines tagged to this vendor (Accounts Payable party)
  const fromParty = await JournalEntry.find({
    ...jeBase,
    lines: {
      $elemMatch: {
        partyType: 'Vendor',
        party: vendorOid
      }
    }
  }).distinct('_id');
  fromParty.forEach((id) => jeIdSet.add(String(id)));

  // GL rows tagged to this vendor (posted JE sync)
  try {
    const GeneralLedger = require('../models/finance/GeneralLedger');
    const fromGl = await GeneralLedger.find({
      partyType: 'Vendor',
      party: vendorOid,
      status: 'posted',
      ...(companyId ? { companyId } : {})
    }).distinct('journalEntry');
    fromGl.forEach((id) => {
      if (id) jeIdSet.add(String(id));
    });
  } catch (_) {
    /* ignore */
  }

  return [...jeIdSet]
    .filter((id) => mongoose.Types.ObjectId.isValid(id))
    .map((id) => new mongoose.Types.ObjectId(id));
};

const buildVendorTrialBalanceRows = async ({ vendorJeIds, from, asOf, companyId }) => {
  const round2 = (n) => Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100;
  if (!vendorJeIds.length) {
    return {
      rows: [],
      totals: { totalDebits: 0, totalCredits: 0, totalOpening: 0, totalClosing: 0, isBalanced: true }
    };
  }

  const openingRows = await JournalEntry.aggregate([
    { $match: { status: 'posted', date: { $lt: from }, _id: { $in: vendorJeIds }, ...(companyId ? { companyId } : {}) } },
    { $unwind: '$lines' },
    {
      $group: {
        _id: '$lines.account',
        openingDebit: { $sum: '$lines.debit' },
        openingCredit: { $sum: '$lines.credit' }
      }
    },
    { $project: { openingBalance: { $subtract: ['$openingDebit', '$openingCredit'] } } }
  ]);

  const movementRows = await JournalEntry.aggregate([
    { $match: { status: 'posted', date: { $gte: from, $lte: asOf }, _id: { $in: vendorJeIds }, ...(companyId ? { companyId } : {}) } },
    { $unwind: '$lines' },
    {
      $group: {
        _id: '$lines.account',
        totalDebit: { $sum: '$lines.debit' },
        totalCredit: { $sum: '$lines.credit' }
      }
    }
  ]);

  const openingByAccount = new Map(openingRows.map((r) => [String(r._id), r.openingBalance || 0]));
  const movementByAccount = new Map(
    movementRows.map((r) => [String(r._id), { totalDebit: r.totalDebit || 0, totalCredit: r.totalCredit || 0 }])
  );

  const accountIds = Array.from(new Set([...openingByAccount.keys(), ...movementByAccount.keys()]));
  const accounts = await Account.find({
    _id: { $in: accountIds },
    ...(companyId ? { companyId } : {})
  }).select('accountNumber name type').lean();

  const rows = accounts
    .map((acc) => {
      const accountId = String(acc._id);
      const openingBalance = round2(openingByAccount.get(accountId) || 0);
      const movement = movementByAccount.get(accountId) || { totalDebit: 0, totalCredit: 0 };
      const totalDebit = round2(movement.totalDebit);
      const totalCredit = round2(movement.totalCredit);
      const closingBalance = round2(openingBalance + totalDebit - totalCredit);
      return {
        _id: acc._id,
        accountNumber: acc.accountNumber,
        accountName: acc.name,
        accountType: acc.type,
        openingBalance,
        totalDebit,
        totalCredit,
        closingBalance,
        netBalance: closingBalance
      };
    })
    .filter((r) =>
      r.openingBalance !== 0 || r.totalDebit !== 0 || r.totalCredit !== 0 || r.closingBalance !== 0
    )
    .sort((a, b) => String(a.accountNumber || '').localeCompare(String(b.accountNumber || '')));

  const totalDebits = round2(rows.reduce((s, r) => s + r.totalDebit, 0));
  const totalCredits = round2(rows.reduce((s, r) => s + r.totalCredit, 0));
  const totalOpening = round2(rows.reduce((s, r) => s + r.openingBalance, 0));
  const totalClosing = round2(rows.reduce((s, r) => s + r.closingBalance, 0));

  return {
    rows,
    totals: {
      totalDebits,
      totalCredits,
      totalOpening,
      totalClosing,
      isBalanced: Math.abs(totalDebits - totalCredits) < 0.01
    }
  };
};

router.get('/vendors',
  authorize('super_admin', 'admin', 'finance_manager', 'procurement_manager'),
  asyncHandler(async (req, res) => {
    const mongoose = require('mongoose');
    const { search, status, page = 1, limit = 100 } = req.query;
    const supplierQuery = {};
    if (status) supplierQuery.status = status;
    const trimmed = search != null ? String(search).trim() : '';
    if (trimmed) {
      const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const wordStartRegex = `(^|\\\\W)${escaped}`;
      supplierQuery.$or = [
        { name: { $regex: wordStartRegex, $options: 'i' } },
        { supplierId: { $regex: escaped, $options: 'i' } },
        { email: { $regex: escaped, $options: 'i' } },
        { contactPerson: { $regex: escaped, $options: 'i' } },
        { phone: { $regex: escaped, $options: 'i' } },
        { vendorCategory: { $regex: escaped, $options: 'i' } },
        { ntnCnic: { $regex: escaped, $options: 'i' } }
      ];
    }

    const skip = (Math.max(1, parseInt(page, 10)) - 1) * parseInt(limit, 10);
    const [suppliers, total] = await Promise.all([
      Supplier.find(supplierQuery).sort({ name: 1 }).skip(skip).limit(parseInt(limit, 10)).lean(),
      Supplier.countDocuments(supplierQuery)
    ]);

    const supplierIds = suppliers.map((s) => s._id);
    const { q } = await financeScope(req);
    const financeAgg = supplierIds.length
      ? await AccountsPayable.aggregate([
        { $match: q({ 'vendor.vendorId': { $in: supplierIds } }) },
        {
          $group: {
            _id: '$vendor.vendorId',
            totalBilled: { $sum: '$totalAmount' },
            totalPaid: { $sum: '$amountPaid' },
            totalAdvanceApplied: { $sum: '$advanceApplied' },
            billCount: { $sum: 1 },
            lastActivity: { $max: '$updatedAt' }
          }
        }
      ])
      : [];

    const financeMap = new Map(financeAgg.map((row) => [String(row._id), row]));
    const vendors = suppliers.map((s) => {
      const fin = financeMap.get(String(s._id));
      const totalBilled = fin?.totalBilled || 0;
      const totalPaid = fin?.totalPaid || 0;
      const totalAdvanceApplied = fin?.totalAdvanceApplied || 0;
      const outstanding = Math.round((totalBilled - totalPaid - totalAdvanceApplied) * 100) / 100;
      return {
        ...s,
        finance: {
          totalBilled: Math.round(totalBilled * 100) / 100,
          totalPaid: Math.round(totalPaid * 100) / 100,
          totalAdvanceApplied: Math.round(totalAdvanceApplied * 100) / 100,
          outstanding,
          billCount: fin?.billCount || 0,
          lastActivity: fin?.lastActivity || null
        }
      };
    });

    res.json({
      success: true,
      data: {
        vendors,
        pagination: {
          page: parseInt(page, 10),
          limit: parseInt(limit, 10),
          total,
          pages: Math.ceil(total / parseInt(limit, 10))
        }
      }
    });
  })
);

router.get('/vendors/:supplierId/trial-balance',
  authorize('super_admin', 'admin', 'finance_manager', 'procurement_manager'),
  asyncHandler(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const mongoose = require('mongoose');
    const { supplierId } = req.params;
    const { asOfDate, fromDate } = req.query;

    if (!mongoose.Types.ObjectId.isValid(supplierId)) {
      return res.status(400).json({ success: false, message: 'Invalid vendor ID' });
    }

    const supplier = await Supplier.findById(supplierId).select('supplierId name').lean();
    if (!supplier) {
      return res.status(404).json({ success: false, message: 'Vendor not found' });
    }

    const asOf = asOfDate ? new Date(asOfDate) : new Date();
    if (asOfDate) asOf.setHours(23, 59, 59, 999);
    const from = fromDate ? new Date(fromDate) : new Date(asOf.getFullYear(), 0, 1);
    from.setHours(0, 0, 0, 0);

    const vendorObjectId = new mongoose.Types.ObjectId(supplierId);
    const { companyId } = await financeScope(req);
    const vendorJeIds = await collectVendorJournalEntryIds(vendorObjectId, companyId);
    const { rows, totals } = await buildVendorTrialBalanceRows({ vendorJeIds, from, asOf, companyId });

    res.json({
      success: true,
      data: {
        vendor: supplier,
        fromDate: from,
        asOfDate: asOf,
        journalEntryCount: vendorJeIds.length,
        rows,
        totals
      }
    });
  })
);

router.get('/vendors/:supplierId/trial-balance/ledger/:accountId',
  authorize('super_admin', 'admin', 'finance_manager', 'procurement_manager'),
  asyncHandler(async (req, res) => {
    const mongoose = require('mongoose');
    const { supplierId, accountId } = req.params;
    const { asOfDate, fromDate } = req.query;

    if (!mongoose.Types.ObjectId.isValid(supplierId) || !mongoose.Types.ObjectId.isValid(accountId)) {
      return res.status(400).json({ success: false, message: 'Invalid vendor or account ID' });
    }

    const asOf = asOfDate ? new Date(asOfDate) : new Date();
    if (asOfDate) asOf.setHours(23, 59, 59, 999);
    const from = fromDate ? new Date(fromDate) : new Date(asOf.getFullYear(), 0, 1);
    from.setHours(0, 0, 0, 0);

    const vendorObjectId = new mongoose.Types.ObjectId(supplierId);
    const accountObjectId = new mongoose.Types.ObjectId(accountId);
    const { companyId } = await financeScope(req);
    const vendorJeIds = await collectVendorJournalEntryIds(vendorObjectId, companyId);

    if (!vendorJeIds.length) {
      return res.json({ success: true, data: [] });
    }

    const rows = await JournalEntry.aggregate([
      { $match: { status: 'posted', date: { $gte: from, $lte: asOf }, _id: { $in: vendorJeIds }, companyId } },
      { $unwind: '$lines' },
      { $match: { 'lines.account': accountObjectId } },
      { $sort: { date: 1, entryNumber: 1 } },
      {
        $project: {
          _id: {
            $concat: [{ $toString: '$_id' }, ':', { $toString: { $ifNull: ['$lines._id', '0'] } }]
          },
          date: 1,
          entryNumber: 1,
          reference: 1,
          description: { $ifNull: ['$lines.description', '$description'] },
          debit: '$lines.debit',
          credit: '$lines.credit',
          department: { $ifNull: ['$lines.department', '$department'] },
          module: 1,
          journalEntry: {
            _id: '$_id',
            entryNumber: '$entryNumber',
            reference: '$reference',
            description: '$description'
          }
        }
      }
    ]);

    res.json({ success: true, data: rows });
  })
);

router.get('/vendors/:supplierId/trial-balance/voucher/:journalEntryId',
  authorize('super_admin', 'admin', 'finance_manager', 'procurement_manager'),
  asyncHandler(async (req, res) => {
    const mongoose = require('mongoose');
    const { supplierId, journalEntryId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(supplierId) || !mongoose.Types.ObjectId.isValid(journalEntryId)) {
      return res.status(400).json({ success: false, message: 'Invalid ID' });
    }

    const vendorObjectId = new mongoose.Types.ObjectId(supplierId);
    const { companyId } = await financeScope(req);
    const vendorJeIds = await collectVendorJournalEntryIds(vendorObjectId, companyId);
    const allowed = vendorJeIds.some((id) => String(id) === String(journalEntryId));
    if (!allowed) {
      return res.status(404).json({ success: false, message: 'Voucher not found for this vendor' });
    }

    const entry = await JournalEntry.findOne({ _id: journalEntryId, companyId }).populate('lines.account', 'accountNumber name type');
    if (!entry) {
      return res.status(404).json({ success: false, message: 'Journal entry not found' });
    }

    res.json({ success: true, data: entry });
  })
);

router.get('/vendors/:supplierId',
  authorize('super_admin', 'admin', 'finance_manager', 'procurement_manager'),
  asyncHandler(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const mongoose = require('mongoose');
    const { supplierId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(supplierId)) {
      return res.status(400).json({ success: false, message: 'Invalid vendor ID' });
    }

    const supplier = await Supplier.findById(supplierId).lean();
    if (!supplier) {
      return res.status(404).json({ success: false, message: 'Vendor not found' });
    }

    const vendorObjectId = new mongoose.Types.ObjectId(supplierId);
    const { q, companyId } = await financeScope(req);
    const [bills, advances, vendorJeIds] = await Promise.all([
      AccountsPayable.find(q({ 'vendor.vendorId': vendorObjectId }))
        .sort({ billDate: -1 })
        .limit(200)
        .lean(),
      VendorAdvance.find(q({ 'vendor.vendorId': vendorObjectId }))
        .sort({ paymentDate: -1 })
        .limit(50)
        .lean(),
      collectVendorJournalEntryIds(vendorObjectId, companyId)
    ]);

    const journalEntries = vendorJeIds.length
      ? await JournalEntry.find({ _id: { $in: vendorJeIds }, status: 'posted' })
          .select('entryNumber date description reference totalDebits totalCredits lines.partyType lines.party lines.debit lines.credit lines.account')
          .sort({ date: -1 })
          .limit(100)
          .lean()
      : [];

    const totalBilled = bills.reduce((s, b) => s + (b.totalAmount || 0), 0);
    const totalPaid = bills.reduce((s, b) => s + (b.amountPaid || 0), 0);
    const totalAdvanceApplied = bills.reduce((s, b) => s + (b.advanceApplied || 0), 0);
    const advanceBalance = advances.reduce(
      (s, a) => s + Math.max(0, (a.amount || 0) - (a.appliedAmount || 0)),
      0
    );

    res.json({
      success: true,
      data: {
        supplier,
        summary: {
          totalBilled: Math.round(totalBilled * 100) / 100,
          totalPaid: Math.round(totalPaid * 100) / 100,
          totalAdvanceApplied: Math.round(totalAdvanceApplied * 100) / 100,
          outstanding: Math.round((totalBilled - totalPaid - totalAdvanceApplied) * 100) / 100,
          advanceBalance: Math.round(advanceBalance * 100) / 100,
          billCount: bills.length,
          journalEntryCount: journalEntries.length
        },
        bills: bills.map((b) => ({
          _id: b._id,
          billNumber: b.billNumber,
          vendorInvoiceNumber: b.vendorInvoiceNumber,
          billDate: b.billDate,
          dueDate: b.dueDate,
          totalAmount: b.totalAmount,
          amountPaid: b.amountPaid,
          advanceApplied: b.advanceApplied,
          balanceDue: b.balanceDue ?? Math.round((b.totalAmount - (b.amountPaid || 0) - (b.advanceApplied || 0)) * 100) / 100,
          status: b.status,
          referenceType: b.referenceType
        })),
        advances: advances.map((a) => ({
          _id: a._id,
          amount: a.amount,
          appliedAmount: a.appliedAmount,
          balance: Math.round(((a.amount || 0) - (a.appliedAmount || 0)) * 100) / 100,
          paymentDate: a.paymentDate,
          reference: a.reference,
          status: a.status
        })),
        journalEntries: journalEntries.map((je) => ({
          _id: je._id,
          entryNumber: je.entryNumber,
          date: je.date,
          description: je.description,
          reference: je.reference,
          totalDebits: je.totalDebits,
          totalCredits: je.totalCredits,
          partyTagged: (je.lines || []).some(
            (l) => String(l.partyType) === 'Vendor' && String(l.party) === String(vendorObjectId)
          )
        }))
      }
    });
  })
);

const collectEmployeeJournalEntryIds = async (employeeObjectId, advanceAccountId, companyId) => {
  const mongoose = require('mongoose');
  const idSet = new Set();
  const employeeOid = mongoose.Types.ObjectId.isValid(String(employeeObjectId))
    ? new mongoose.Types.ObjectId(employeeObjectId)
    : null;
  if (!employeeOid) return [];

  const caFilter = { advanceToEmployee: employeeOid };
  if (companyId) caFilter.companyId = companyId;

  const cas = await CashApproval.find(caFilter)
    .select('_id voucherEntryId')
    .lean();

  cas.forEach((ca) => {
    if (ca._id) idSet.add(String(ca._id));
    if (ca.voucherEntryId) idSet.add(String(ca.voucherEntryId));
  });

  const referenceIds = [...idSet]
    .filter((id) => mongoose.Types.ObjectId.isValid(id))
    .map((id) => new mongoose.Types.ObjectId(id));

  const jeIds = new Set();
  const jeFilter = { status: 'posted', ...(companyId ? { companyId } : {}) };
  if (referenceIds.length) {
    const fromRef = await JournalEntry.find({
      ...jeFilter,
      referenceId: { $in: referenceIds }
    })
      .distinct('_id')
      .lean();
    fromRef.forEach((id) => jeIds.add(String(id)));
  }

  if (advanceAccountId && mongoose.Types.ObjectId.isValid(String(advanceAccountId))) {
    const accountObjectId = new mongoose.Types.ObjectId(advanceAccountId);
    const fromAccount = await JournalEntry.find({
      ...jeFilter,
      'lines.account': accountObjectId
    })
      .distinct('_id')
      .lean();
    fromAccount.forEach((id) => jeIds.add(String(id)));
  }

  // Manual journal lines tagged to this employee (Accounts Payable / advances party)
  const fromParty = await JournalEntry.find({
    ...jeFilter,
    lines: {
      $elemMatch: {
        partyType: 'Employee',
        party: employeeOid
      }
    }
  })
    .distinct('_id')
    .lean();
  fromParty.forEach((id) => jeIds.add(String(id)));

  try {
    const GeneralLedger = require('../models/finance/GeneralLedger');
    const fromGl = await GeneralLedger.find({
      partyType: 'Employee',
      party: employeeOid,
      status: 'posted',
      ...(companyId ? { companyId } : {})
    }).distinct('journalEntry');
    fromGl.forEach((id) => {
      if (id) jeIds.add(String(id));
    });
  } catch (_) {
    /* ignore */
  }

  return [...jeIds].map((id) => new mongoose.Types.ObjectId(id));
};

const roundFinance2 = (n) => Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100;

const SETTLED_CA_STATUSES = ['Payment Settled', 'Completed'];

router.get('/employees',
  authorize('super_admin', 'admin', 'finance_manager', 'procurement_manager'),
  asyncHandler(async (req, res) => {
    const { search, status, page = 1, limit = 100 } = req.query;
    const employeeQuery = {};
    if (status) employeeQuery.employmentStatus = status;
    const trimmed = search != null ? String(search).trim() : '';
    if (trimmed) {
      const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      employeeQuery.$or = [
        { firstName: { $regex: escaped, $options: 'i' } },
        { lastName: { $regex: escaped, $options: 'i' } },
        { employeeId: { $regex: escaped, $options: 'i' } },
        { email: { $regex: escaped, $options: 'i' } },
        { phone: { $regex: escaped, $options: 'i' } }
      ];
    }

    const skip = (Math.max(1, parseInt(page, 10)) - 1) * parseInt(limit, 10);
    const [employees, total] = await Promise.all([
      Employee.find(employeeQuery)
        .select(
          'firstName lastName employeeId email phone employmentStatus placementDepartment employeeAdvanceAccount employeeAdvanceAccountNumber'
        )
        .populate('placementDepartment', 'name')
        .populate('employeeAdvanceAccount', 'accountNumber name')
        .sort({ firstName: 1, lastName: 1 })
        .skip(skip)
        .limit(parseInt(limit, 10))
        .lean(),
      Employee.countDocuments(employeeQuery)
    ]);

    const employeeIds = employees.map((e) => e._id);
    const { q } = await financeScope(req);
    const financeAgg = employeeIds.length
      ? await CashApproval.aggregate([
        { $match: q({ advanceToEmployee: { $in: employeeIds } }) },
        {
          $group: {
            _id: '$advanceToEmployee',
            totalAdvanced: {
              $sum: {
                $cond: [
                  { $ifNull: ['$advanceIssuedAt', false] },
                  { $ifNull: ['$advanceAmount', '$totalAmount'] },
                  0
                ]
              }
            },
            totalSettled: {
              $sum: {
                $cond: [
                  { $in: ['$status', SETTLED_CA_STATUSES] },
                  { $ifNull: ['$actualAmountSpent', { $ifNull: ['$advanceAmount', '$totalAmount'] }] },
                  0
                ]
              }
            },
            caCount: { $sum: 1 },
            lastActivity: { $max: '$updatedAt' }
          }
        }
      ])
      : [];

    const financeMap = new Map(financeAgg.map((row) => [String(row._id), row]));
    const rows = employees.map((e) => {
      const fin = financeMap.get(String(e._id));
      const totalAdvanced = roundFinance2(fin?.totalAdvanced);
      const totalSettled = roundFinance2(fin?.totalSettled);
      const outstanding = roundFinance2(Math.max(0, totalAdvanced - totalSettled));
      const displayName = [e.firstName, e.lastName].filter(Boolean).join(' ').trim() || e.employeeId || '—';
      return {
        ...e,
        name: displayName,
        departmentName: e.placementDepartment?.name || '—',
        finance: {
          totalAdvanced,
          totalSettled,
          outstanding,
          caCount: fin?.caCount || 0,
          lastActivity: fin?.lastActivity || null
        }
      };
    });

    res.json({
      success: true,
      data: {
        employees: rows,
        pagination: {
          page: parseInt(page, 10),
          limit: parseInt(limit, 10),
          total,
          pages: Math.ceil(total / parseInt(limit, 10))
        }
      }
    });
  })
);

router.get('/employees/:employeeId/trial-balance',
  authorize('super_admin', 'admin', 'finance_manager', 'procurement_manager'),
  asyncHandler(async (req, res) => {
    const mongoose = require('mongoose');
    const { employeeId } = req.params;
    const { asOfDate, fromDate } = req.query;

    if (!mongoose.Types.ObjectId.isValid(employeeId)) {
      return res.status(400).json({ success: false, message: 'Invalid employee ID' });
    }

    const employee = await Employee.findById(employeeId)
      .select('employeeId firstName lastName employeeAdvanceAccount employeeAdvanceAccountNumber')
      .lean();
    if (!employee) {
      return res.status(404).json({ success: false, message: 'Employee not found' });
    }

    const asOf = asOfDate ? new Date(asOfDate) : new Date();
    if (asOfDate) asOf.setHours(23, 59, 59, 999);
    const from = fromDate ? new Date(fromDate) : new Date(asOf.getFullYear(), 0, 1);
    from.setHours(0, 0, 0, 0);

    const employeeObjectId = new mongoose.Types.ObjectId(employeeId);
    const advanceAccountId = employee.employeeAdvanceAccount;
    const { companyId } = await financeScope(req);
    const employeeJeIds = await collectEmployeeJournalEntryIds(employeeObjectId, advanceAccountId, companyId);
    const { rows, totals } = await buildVendorTrialBalanceRows({ vendorJeIds: employeeJeIds, from, asOf, companyId });

    res.json({
      success: true,
      data: {
        employee: {
          ...employee,
          name: [employee.firstName, employee.lastName].filter(Boolean).join(' ').trim()
        },
        fromDate: from,
        asOfDate: asOf,
        journalEntryCount: employeeJeIds.length,
        rows,
        totals
      }
    });
  })
);

router.get('/employees/:employeeId/trial-balance/ledger/:accountId',
  authorize('super_admin', 'admin', 'finance_manager', 'procurement_manager'),
  asyncHandler(async (req, res) => {
    const mongoose = require('mongoose');
    const { employeeId, accountId } = req.params;
    const { asOfDate, fromDate } = req.query;

    if (!mongoose.Types.ObjectId.isValid(employeeId) || !mongoose.Types.ObjectId.isValid(accountId)) {
      return res.status(400).json({ success: false, message: 'Invalid employee or account ID' });
    }

    const employee = await Employee.findById(employeeId).select('employeeAdvanceAccount').lean();
    if (!employee) {
      return res.status(404).json({ success: false, message: 'Employee not found' });
    }

    const asOf = asOfDate ? new Date(asOfDate) : new Date();
    if (asOfDate) asOf.setHours(23, 59, 59, 999);
    const from = fromDate ? new Date(fromDate) : new Date(asOf.getFullYear(), 0, 1);
    from.setHours(0, 0, 0, 0);

    const employeeObjectId = new mongoose.Types.ObjectId(employeeId);
    const accountObjectId = new mongoose.Types.ObjectId(accountId);
    const { companyId } = await financeScope(req);
    const employeeJeIds = await collectEmployeeJournalEntryIds(
      employeeObjectId,
      employee.employeeAdvanceAccount,
      companyId
    );

    if (!employeeJeIds.length) {
      return res.json({ success: true, data: [] });
    }

    const rows = await JournalEntry.aggregate([
      { $match: { status: 'posted', date: { $gte: from, $lte: asOf }, _id: { $in: employeeJeIds }, companyId } },
      { $unwind: '$lines' },
      { $match: { 'lines.account': accountObjectId } },
      { $sort: { date: 1, entryNumber: 1 } },
      {
        $project: {
          _id: {
            $concat: [{ $toString: '$_id' }, ':', { $toString: { $ifNull: ['$lines._id', '0'] } }]
          },
          date: 1,
          entryNumber: 1,
          reference: 1,
          description: { $ifNull: ['$lines.description', '$description'] },
          debit: '$lines.debit',
          credit: '$lines.credit',
          department: { $ifNull: ['$lines.department', '$department'] },
          module: 1,
          journalEntry: {
            _id: '$_id',
            entryNumber: '$entryNumber',
            reference: '$reference',
            description: '$description'
          }
        }
      }
    ]);

    res.json({ success: true, data: rows });
  })
);

router.get('/employees/:employeeId/trial-balance/voucher/:journalEntryId',
  authorize('super_admin', 'admin', 'finance_manager', 'procurement_manager'),
  asyncHandler(async (req, res) => {
    const mongoose = require('mongoose');
    const { employeeId, journalEntryId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(employeeId) || !mongoose.Types.ObjectId.isValid(journalEntryId)) {
      return res.status(400).json({ success: false, message: 'Invalid ID' });
    }

    const employee = await Employee.findById(employeeId).select('employeeAdvanceAccount').lean();
    if (!employee) {
      return res.status(404).json({ success: false, message: 'Employee not found' });
    }

    const employeeObjectId = new mongoose.Types.ObjectId(employeeId);
    const { companyId } = await financeScope(req);
    const employeeJeIds = await collectEmployeeJournalEntryIds(
      employeeObjectId,
      employee.employeeAdvanceAccount,
      companyId
    );
    const allowed = employeeJeIds.some((id) => String(id) === String(journalEntryId));
    if (!allowed) {
      return res.status(404).json({ success: false, message: 'Voucher not found for this employee' });
    }

    const entry = await JournalEntry.findOne({ _id: journalEntryId, companyId }).populate('lines.account', 'accountNumber name type');
    if (!entry) {
      return res.status(404).json({ success: false, message: 'Journal entry not found' });
    }

    res.json({ success: true, data: entry });
  })
);

router.get('/employees/:employeeId',
  authorize('super_admin', 'admin', 'finance_manager', 'procurement_manager'),
  asyncHandler(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const mongoose = require('mongoose');
    const { employeeId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(employeeId)) {
      return res.status(400).json({ success: false, message: 'Invalid employee ID' });
    }

    const employee = await Employee.findById(employeeId)
      .populate('placementDepartment', 'name')
      .populate('employeeAdvanceAccount', 'accountNumber name detailType type')
      .lean();
    if (!employee) {
      return res.status(404).json({ success: false, message: 'Employee not found' });
    }

    const employeeObjectId = new mongoose.Types.ObjectId(employeeId);
    const employeeFilter = await buildCashApprovalEmployeeFilter(employee);
    const { q, companyId } = await financeScope(req);
    const baseFilter = employeeFilter || { advanceToEmployee: employeeObjectId };
    const [cashApprovals, employeeJeIds] = await Promise.all([
      CashApproval.find(q(baseFilter))
      .sort({ approvalDate: -1, createdAt: -1 })
      .limit(200)
      .select(
        'caNumber status totalAmount advanceAmount actualAmountSpent apAdvanceApplied advanceIssuedAt settlementDate approvalDate purpose originatingModule voucherEntryId advanceGlAccountNumber'
      )
        .lean(),
      collectEmployeeJournalEntryIds(employeeObjectId, employee.employeeAdvanceAccount, companyId)
    ]);

    const journalEntries = employeeJeIds.length
      ? await JournalEntry.find({ _id: { $in: employeeJeIds }, status: 'posted' })
          .select('entryNumber date description reference totalDebits totalCredits lines.partyType lines.party lines.debit lines.credit')
          .sort({ date: -1 })
          .limit(100)
          .lean()
      : [];

    let totalAdvanced = 0;
    let totalSettled = 0;
    cashApprovals.forEach((ca) => {
      if (ca.advanceIssuedAt) {
        totalAdvanced += Number(ca.advanceAmount || ca.totalAmount || 0);
      }
      if (SETTLED_CA_STATUSES.includes(ca.status)) {
        totalSettled += Number(ca.actualAmountSpent || ca.advanceAmount || ca.totalAmount || 0);
      }
    });

    const displayName = [employee.firstName, employee.lastName].filter(Boolean).join(' ').trim();

    res.json({
      success: true,
      data: {
        employee: { ...employee, name: displayName, departmentName: employee.placementDepartment?.name || '—' },
        summary: {
          totalAdvanced: roundFinance2(totalAdvanced),
          totalSettled: roundFinance2(totalSettled),
          outstanding: roundFinance2(Math.max(0, totalAdvanced - totalSettled)),
          caCount: cashApprovals.length,
          journalEntryCount: journalEntries.length
        },
        cashApprovals: cashApprovals.map((ca) => {
          const advanceAmount = Math.round((Number(ca.advanceAmount) || Number(ca.totalAmount) || 0) * 100) / 100;
          const apApplied = Math.round((Number(ca.apAdvanceApplied) || 0) * 100) / 100;
          const issued = Boolean(ca.advanceIssuedAt);
          return {
            _id: ca._id,
            caNumber: ca.caNumber,
            status: ca.status,
            purpose: ca.purpose,
            totalAmount: ca.totalAmount,
            advanceAmount: ca.advanceAmount,
            apAdvanceApplied: apApplied,
            actualAmountSpent: ca.actualAmountSpent,
            advanceIssuedAt: ca.advanceIssuedAt,
            settlementDate: ca.settlementDate,
            approvalDate: ca.approvalDate,
            originatingModule: ca.originatingModule,
            voucherEntryId: ca.voucherEntryId,
            applied: issued ? apApplied : null,
            open: issued ? Math.max(0, Math.round((advanceAmount - apApplied) * 100) / 100) : null
          };
        }),
        journalEntries: journalEntries.map((je) => ({
          _id: je._id,
          entryNumber: je.entryNumber,
          date: je.date,
          description: je.description,
          reference: je.reference,
          totalDebits: je.totalDebits,
          totalCredits: je.totalCredits,
          partyTagged: (je.lines || []).some(
            (l) => String(l.partyType) === 'Employee' && String(l.party) === String(employeeObjectId)
          )
        }))
      }
    });
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// VENDOR STATEMENT
// ─────────────────────────────────────────────────────────────────────────────
router.get('/reports/vendor-statement/:supplierId',
  authorize('super_admin', 'admin', 'finance_manager', 'procurement_manager'),
  asyncHandler(async (req, res) => {
    const mongoose = require('mongoose');
    const { supplierId } = req.params;

    // Guard against null / invalid ObjectId (bills with no linked supplier)
    if (!supplierId || supplierId === 'null' || supplierId === 'undefined' || !mongoose.Types.ObjectId.isValid(supplierId)) {
      return res.status(400).json({ success: false, message: 'Invalid supplier ID' });
    }

    const { fromDate, toDate } = req.query;
    const { q } = await financeScope(req);
    const matchFilter = q({ supplier: new mongoose.Types.ObjectId(supplierId) });
    if (fromDate || toDate) {
      matchFilter.createdAt = {};
      if (fromDate) matchFilter.createdAt.$gte = new Date(fromDate);
      if (toDate) matchFilter.createdAt.$lte = new Date(toDate);
    }

    const bills = await AccountsPayable.find(matchFilter)
      .populate('supplier', 'name code email phone')
      .populate('createdBy', 'name')
      .sort({ createdAt: 1 });

    const totalBilled = bills.reduce((s, b) => s + (b.amount || 0), 0);
    const totalPaid = bills.reduce((s, b) => s + (b.paidAmount || 0), 0);
    const totalBalance = bills.reduce((s, b) => s + (b.balance || 0), 0);

    res.json({
      success: true,
      data: {
        supplier: bills[0]?.supplier || { _id: supplierId },
        bills,
        summary: {
          totalBilled: Math.round(totalBilled * 100) / 100,
          totalPaid: Math.round(totalPaid * 100) / 100,
          totalBalance: Math.round(totalBalance * 100) / 100
        }
      }
    });
  })
);

// Supplier list for vendor statement
router.get('/reports/vendor-statement',
  authorize('super_admin', 'admin', 'finance_manager', 'procurement_manager'),
  asyncHandler(async (req, res) => {
    const mongoose = require('mongoose');
    const { q } = await financeScope(req);
    const summary = await AccountsPayable.aggregate([
      { $match: q({ supplier: { $exists: true, $ne: null } }) },
      {
        $group: {
        _id: '$supplier',
        supplierName: { $first: '$supplierName' },
          totalBilled: { $sum: '$amount' },
          totalPaid: { $sum: '$paidAmount' },
        totalBalance: { $sum: '$balance' },
        lastActivity: { $max: '$createdAt' }
        }
      },
      { $sort: { supplierName: 1 } }
    ]);
    res.json({ success: true, data: summary });
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// FINANCE CUSTOMERS (unified list + detail like vendors)
// ─────────────────────────────────────────────────────────────────────────────
const SalesCustomer = require('../models/sales/SalesCustomer');
const { isHistoricalCompany: isHistoricalFinanceCompany } = require('../utils/financeCompanyContext');

/**
 * AR invoices on production are mostly companyId=null (legacy).
 * Include those alongside the selected company so customer totals appear.
 */
const customerArCompanyQuery = (filters = {}, company) => {
  if (!company?._id || company.isAll || isHistoricalFinanceCompany(company)) {
    return companyQuery(filters, company);
  }
  const base = { ...filters };
  const companyFilter = {
    $or: [
      { companyId: company._id },
      { companyId: null },
      { companyId: { $exists: false } }
    ]
  };
  if (Object.keys(base).length === 0) return companyFilter;
  return { $and: [base, companyFilter] };
};

const collectCustomerJournalEntryIds = async (customerObjectId, companyId) => {
  const mongoose = require('mongoose');
  const customerOid = mongoose.Types.ObjectId.isValid(String(customerObjectId))
    ? new mongoose.Types.ObjectId(String(customerObjectId))
    : null;
  if (!customerOid) return [];

  const jeIdSet = new Set();
  const jeBase = { status: 'posted', ...(companyId ? { companyId } : {}) };

  const fromParty = await JournalEntry.find({
    ...jeBase,
    lines: {
      $elemMatch: {
        partyType: 'Customer',
        party: customerOid
      }
    }
  }).distinct('_id');
  fromParty.forEach((id) => jeIdSet.add(String(id)));

  try {
    const fromGl = await GeneralLedger.find({
      partyType: 'Customer',
      party: customerOid,
      status: 'posted',
      ...(companyId ? { companyId } : {})
    }).distinct('journalEntry');
    fromGl.forEach((id) => {
      if (id) jeIdSet.add(String(id));
    });
  } catch (_) {
    /* ignore */
  }

  // Also pick up AR invoice-linked journal entries
  try {
    const arIds = await AccountsReceivable.find({
      'customer.customerId': customerOid,
      ...(companyId ? { companyId } : {})
    }).distinct('_id');
    if (arIds.length) {
      const fromAr = await JournalEntry.find({
        ...jeBase,
        referenceId: { $in: arIds }
      }).distinct('_id');
      fromAr.forEach((id) => jeIdSet.add(String(id)));
    }
  } catch (_) {
    /* ignore */
  }

  return [...jeIdSet]
    .filter((id) => mongoose.Types.ObjectId.isValid(id))
    .map((id) => new mongoose.Types.ObjectId(id));
};

/** Best available "received" amount on an AR invoice (field vs payments vs installments). */
const invoiceReceivedExpr = {
  $max: [
    { $ifNull: ['$amountPaid', 0] },
    { $ifNull: ['$paidAmount', 0] },
    {
      $reduce: {
        input: { $ifNull: ['$payments', []] },
        initialValue: 0,
        in: { $add: ['$$value', { $ifNull: ['$$this.amount', 0] }] }
      }
    },
    {
      $reduce: {
        input: { $ifNull: ['$installments', []] },
        initialValue: 0,
        in: { $add: ['$$value', { $ifNull: ['$$this.paidAmount', 0] }] }
      }
    }
  ]
};

const invoicePaidAmount = (inv) => {
  const fromField = Number(inv.amountPaid || inv.paidAmount || 0);
  const fromPayments = (inv.payments || []).reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const fromInstallments = (inv.installments || []).reduce(
    (s, row) => s + (Number(row.paidAmount) || 0),
    0
  );
  return Math.max(fromField, fromPayments, fromInstallments);
};

const customerArMatch = (customer, companyQ) => {
  const mongoose = require('mongoose');
  const name = String(customer.name || '').trim();
  const or = [];
  if (customer._id && mongoose.Types.ObjectId.isValid(String(customer._id))) {
    or.push({ 'customer.customerId': new mongoose.Types.ObjectId(String(customer._id)) });
  }
  if (name) {
    or.push({
      'customer.name': new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i')
    });
  }
  if (!or.length) return companyQ({ _id: null });
  return companyQ({ $or: or });
};

/** Only real Finance Customers (SalesCustomer) — not AR invoice parties. */
const resolveFinanceCustomer = async (customerId) => {
  const mongoose = require('mongoose');
  if (!mongoose.Types.ObjectId.isValid(String(customerId))) {
    return null;
  }
  const sales = await SalesCustomer.findById(customerId).lean();
  if (!sales) return null;
  return { ...sales, source: 'sales_customer' };
};

router.get('/customers',
  authorize('super_admin', 'admin', 'finance_manager'),
  asyncHandler(async (req, res) => {
    const { search, status, page = 1, limit = 100 } = req.query;
    const { company } = await financeScope(req);
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(500, Math.max(1, parseInt(limit, 10) || 100));
    const trimmed = search != null ? String(search).trim() : '';

    // List only customers created in Finance Customers (SalesCustomer)
    const customerQuery = {};
    if (status) customerQuery.status = status;
    if (trimmed) {
      const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      customerQuery.$or = [
        { name: { $regex: escaped, $options: 'i' } },
        { company: { $regex: escaped, $options: 'i' } },
        { email: { $regex: escaped, $options: 'i' } },
        { phone: { $regex: escaped, $options: 'i' } }
      ];
    }

    const [customers, total] = await Promise.all([
      SalesCustomer.find(customerQuery)
        .sort({ name: 1 })
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum)
        .lean(),
      SalesCustomer.countDocuments(customerQuery)
    ]);

    const customerIds = customers.map((c) => c._id);
    const names = customers.map((c) => c.name).filter(Boolean);
    const arQ = (filters = {}) => customerArCompanyQuery(filters, company);

    const financeAgg = customerIds.length
      ? await AccountsReceivable.aggregate([
        {
          $match: arQ({
            $or: [
              { 'customer.customerId': { $in: customerIds } },
              ...(names.length ? [{ 'customer.name': { $in: names } }] : [])
            ]
          })
        },
        { $addFields: { _received: invoiceReceivedExpr } },
        {
          $group: {
            _id: {
              $cond: [
                { $ifNull: ['$customer.customerId', false] },
                { $toString: '$customer.customerId' },
                { $toLower: { $ifNull: ['$customer.name', ''] } }
              ]
            },
            totalInvoiced: { $sum: { $ifNull: ['$totalAmount', 0] } },
            totalReceived: { $sum: '$_received' },
            invoiceCount: { $sum: 1 },
            lastActivity: { $max: '$updatedAt' }
          }
        }
      ])
      : [];

    const byId = new Map();
    const byName = new Map();
    const idSet = new Set(customerIds.map((id) => String(id)));
    financeAgg.forEach((row) => {
      const key = String(row._id || '');
      if (idSet.has(key)) byId.set(key, row);
      else byName.set(key.toLowerCase(), row);
    });

    const rows = customers.map((c) => {
      const fin = byId.get(String(c._id)) || byName.get(String(c.name || '').toLowerCase());
      const totalInvoiced = fin?.totalInvoiced || 0;
      const totalReceived = fin?.totalReceived || 0;
      return {
        ...c,
        source: 'sales_customer',
        finance: {
          totalInvoiced: Math.round(totalInvoiced * 100) / 100,
          totalReceived: Math.round(totalReceived * 100) / 100,
          outstanding: Math.round((totalInvoiced - totalReceived) * 100) / 100,
          invoiceCount: fin?.invoiceCount || 0,
          lastActivity: fin?.lastActivity || null
        }
      };
    });

    res.json({
      success: true,
      data: {
        customers: rows,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          pages: Math.ceil(total / limitNum) || 1
        }
      }
    });
  })
);

router.post('/customers',
  authorize('super_admin', 'admin', 'finance_manager'),
  [
    body('name').notEmpty().withMessage('Customer name is required'),
    body('email').optional({ checkFalsy: true }).isEmail().withMessage('Email must be valid')
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: errors.array()[0]?.msg || 'Validation failed',
        errors: errors.array()
      });
    }
    const payload = { ...req.body };
    if (payload.email === '') delete payload.email;
    const customer = await SalesCustomer.create({
      ...payload,
      owner: req.user?._id
    });
    res.status(201).json({
      success: true,
      message: 'Customer created successfully',
      data: customer
    });
  })
);

router.get('/customers/:customerId',
  authorize('super_admin', 'admin', 'finance_manager'),
  asyncHandler(async (req, res) => {
    const mongoose = require('mongoose');
    const { customerId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(customerId)) {
      return res.status(400).json({ success: false, message: 'Invalid customer ID' });
    }

    const { company, companyId } = await financeScope(req);
    const arQ = (filters = {}) => customerArCompanyQuery(filters, company);
    const customer = await resolveFinanceCustomer(customerId);
    if (!customer) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }

    const arFilter = customerArMatch(customer, arQ);

    const [invoices, customerJeIds] = await Promise.all([
      AccountsReceivable.find(arFilter)
        .sort({ invoiceDate: -1, createdAt: -1 })
        .limit(500)
        .lean(),
      collectCustomerJournalEntryIds(customer._id, companyId)
    ]);

    const journalEntries = customerJeIds.length
      ? await JournalEntry.find({ _id: { $in: customerJeIds }, status: 'posted' })
          .select('entryNumber date description reference totalDebits totalCredits voucherSeries referenceType referenceId lines.partyType lines.party lines.debit lines.credit')
          .sort({ date: -1 })
          .limit(200)
          .lean()
      : [];

    const payments = [];
    const paymentJeIds = [];
    invoices.forEach((inv) => {
      (inv.payments || []).forEach((p) => {
        const jeId = p.journalEntry?._id || p.journalEntry || null;
        if (jeId) paymentJeIds.push(jeId);
        payments.push({
          _id: p._id,
          invoiceNumber: inv.invoiceNumber,
          invoiceId: inv._id,
          paymentDate: p.paymentDate,
          amount: p.amount,
          paymentMethod: p.paymentMethod,
          reference: p.reference,
          journalEntryId: jeId ? String(jeId) : null
        });
      });
    });
    payments.sort((a, b) => new Date(b.paymentDate || 0) - new Date(a.paymentDate || 0));

    const invoiceIds = invoices.map((i) => i._id);
    const receiptOr = [
      ...(invoiceIds.length ? [{ referenceId: { $in: invoiceIds } }] : []),
      ...(customerJeIds.length ? [{ _id: { $in: customerJeIds } }] : []),
      {
        lines: {
          $elemMatch: {
            partyType: 'Customer',
            party: new mongoose.Types.ObjectId(String(customer._id))
          }
        }
      },
      ...(paymentJeIds.length ? [{ _id: { $in: paymentJeIds } }] : [])
    ];
    const receiptDocs = await JournalEntry.find({
      status: 'posted',
      $and: [
        {
          $or: [
            { voucherSeries: 'RV' },
            { referenceType: 'receipt' },
            { entryNumber: { $regex: /^RV/i } }
          ]
        },
        { $or: receiptOr }
      ]
    })
      .select('entryNumber date description reference totalDebits totalCredits voucherSeries referenceType referenceId')
      .sort({ date: -1 })
      .limit(200)
      .lean();

    const invoiceById = new Map(invoices.map((i) => [String(i._id), i]));
    const receipts = receiptDocs.map((je) => {
      const inv = je.referenceId ? invoiceById.get(String(je.referenceId)) : null;
      return {
        _id: je._id,
        entryNumber: je.entryNumber,
        date: je.date,
        description: je.description,
        reference: je.reference,
        amount: Math.round((Number(je.totalDebits) || Number(je.totalCredits) || 0) * 100) / 100,
        invoiceNumber: inv?.invoiceNumber || null,
        invoiceId: inv?._id || je.referenceId || null
      };
    });

    // Cost Center P&L: Sales = open invoices; Cost of Sales = AP bills sharing invoice cost centers / customer name
    const mappedInvoices = invoices.map((inv) => {
      const paid = invoicePaidAmount(inv);
      return {
        _id: inv._id,
        invoiceNumber: inv.invoiceNumber,
        invoiceDate: inv.invoiceDate || inv.createdAt,
        dueDate: inv.dueDate,
        totalAmount: inv.totalAmount,
        paidAmount: paid,
        amountPaid: paid,
        balance: Math.round(((inv.totalAmount || 0) - paid) * 100) / 100,
        status: inv.status,
        costCenter: inv.costCenter || null
      };
    });

    const openInvoices = mappedInvoices.filter(
      (inv) =>
        inv.status !== 'cancelled' &&
        inv.status !== 'paid' &&
        (Number(inv.balance) || 0) > 0.009
    );

    const ccIds = [
      ...new Set(
        invoices
          .map((i) => (i.costCenter && i.costCenter._id ? i.costCenter._id : i.costCenter))
          .filter(Boolean)
          .map((id) => String(id))
          .filter((id) => mongoose.Types.ObjectId.isValid(id))
      )
    ].map((id) => new mongoose.Types.ObjectId(id));

    const billOr = [];
    if (ccIds.length) {
      const billRefIds = await JournalEntry.find({
        status: 'posted',
        referenceType: { $in: ['bill', 'payment'] },
        $or: [{ costCenter: { $in: ccIds } }, { 'lines.costCenter': { $in: ccIds } }]
      }).distinct('referenceId');
      const validBillRefs = billRefIds.filter((id) => id && mongoose.Types.ObjectId.isValid(String(id)));
      if (validBillRefs.length) billOr.push({ _id: { $in: validBillRefs } });
    }
    const custName = String(customer.name || '').trim();
    if (custName) {
      const nameRx = new RegExp(custName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      billOr.push(
        { company: nameRx },
        { project: nameRx },
        { notes: nameRx },
        { forWhat: nameRx },
        { description: nameRx }
      );
    }

    let costBills = [];
    if (billOr.length) {
      costBills = await AccountsPayable.find(companyId ? { $and: [{ $or: billOr }, { $or: [{ companyId }, { companyId: null }, { companyId: { $exists: false } }] }] } : { $or: billOr })
        .sort({ billDate: -1 })
        .limit(200)
        .lean();
    }

    const salesTotal = openInvoices.reduce((s, i) => s + (Number(i.totalAmount) || 0), 0);
    const costOfSalesTotal = costBills.reduce((s, b) => s + (Number(b.totalAmount) || 0), 0);
    const netProfit = Math.round((salesTotal - costOfSalesTotal) * 100) / 100;
    const profitPercent = salesTotal > 0 ? Math.round((netProfit / salesTotal) * 10000) / 100 : 0;

    const totalInvoiced = mappedInvoices.reduce((s, i) => s + (i.totalAmount || 0), 0);
    const totalReceived = mappedInvoices.reduce((s, i) => s + (i.paidAmount || 0), 0);
    const totalPayments = payments.reduce((s, p) => s + (Number(p.amount) || 0), 0);

    res.json({
      success: true,
      data: {
        customer,
        summary: {
          totalInvoiced: Math.round(totalInvoiced * 100) / 100,
          totalReceived: Math.round(totalReceived * 100) / 100,
          outstanding: Math.round((totalInvoiced - totalReceived) * 100) / 100,
          invoiceCount: mappedInvoices.length,
          paymentCount: payments.length,
          paymentTotal: Math.round(totalPayments * 100) / 100,
          journalEntryCount: journalEntries.length,
          receiptCount: receipts.length
        },
        invoices: mappedInvoices,
        payments: payments.slice(0, 200),
        receipts,
        costCenter: {
          openInvoices,
          bills: costBills.map((b) => ({
            _id: b._id,
            billNumber: b.billNumber,
            billDate: b.billDate,
            dueDate: b.dueDate,
            vendorName: b.vendor?.name || b.vendorName || '—',
            totalAmount: b.totalAmount || 0,
            amountPaid: b.amountPaid || 0,
            balanceDue: Math.round(((b.totalAmount || 0) - (b.amountPaid || 0) - (b.advanceApplied || 0)) * 100) / 100,
            status: b.status
          })),
          sales: Math.round(salesTotal * 100) / 100,
          costOfSales: Math.round(costOfSalesTotal * 100) / 100,
          netProfit,
          profitPercent
        },
        journalEntries: journalEntries.map((je) => ({
          _id: je._id,
          entryNumber: je.entryNumber,
          date: je.date,
          description: je.description,
          reference: je.reference,
          totalDebits: je.totalDebits,
          totalCredits: je.totalCredits,
          partyTagged: (je.lines || []).some(
            (l) => String(l.partyType) === 'Customer' && String(l.party) === String(customer._id)
          )
        }))
      }
    });
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// CUSTOMER STATEMENT
// ─────────────────────────────────────────────────────────────────────────────
router.get('/reports/customer-statement',
  authorize('super_admin', 'admin', 'finance_manager'),
  asyncHandler(async (req, res) => {
    const { q } = await financeScope(req);
    const summary = await AccountsReceivable.aggregate([
      { $match: q({}) },
      {
        $group: {
          _id: '$customer.name',
        customerEmail: { $first: '$customer.email' },
        totalInvoiced: { $sum: '$totalAmount' },
          totalReceived: {
            $sum: { $ifNull: ['$amountPaid', { $ifNull: ['$paidAmount', 0] }] }
          },
          totalBalance: {
            $sum: {
              $subtract: [
                '$totalAmount',
                { $ifNull: ['$amountPaid', { $ifNull: ['$paidAmount', 0] }] }
              ]
            }
          },
          lastActivity: { $max: '$createdAt' }
        }
      },
      { $match: { _id: { $ne: null } } },
      { $sort: { _id: 1 } }
    ]);

    // Include customers who only appear via party-tagged journal entries
    try {
      const SalesCustomer = require('../models/sales/SalesCustomer');
      const partyAgg = await JournalEntry.aggregate([
        { $match: q({ status: 'posted', 'lines.partyType': 'Customer' }) },
        { $unwind: '$lines' },
        { $match: { 'lines.partyType': 'Customer', 'lines.party': { $ne: null } } },
        {
          $group: {
            _id: '$lines.party',
            partyDebits: { $sum: { $ifNull: ['$lines.debit', 0] } },
            partyCredits: { $sum: { $ifNull: ['$lines.credit', 0] } },
            lastActivity: { $max: '$date' }
          }
        }
      ]);
      if (partyAgg.length) {
        const byName = new Map(summary.map((row) => [String(row._id).toLowerCase(), row]));
        const customers = await SalesCustomer.find({
          _id: { $in: partyAgg.map((r) => r._id) }
        })
          .select('_id name email')
          .lean();
        const customerById = new Map(customers.map((c) => [String(c._id), c]));
        partyAgg.forEach((row) => {
          const cust = customerById.get(String(row._id));
          if (!cust?.name) return;
          const key = String(cust.name).toLowerCase();
          const existing = byName.get(key);
          if (existing) {
            if (row.lastActivity && (!existing.lastActivity || row.lastActivity > existing.lastActivity)) {
              existing.lastActivity = row.lastActivity;
            }
          } else {
            const added = {
              _id: cust.name,
              customerEmail: cust.email || '',
              totalInvoiced: 0,
              totalReceived: 0,
              totalBalance: Math.round(((row.partyDebits || 0) - (row.partyCredits || 0)) * 100) / 100,
              lastActivity: row.lastActivity || null
            };
            summary.push(added);
            byName.set(key, added);
          }
        });
        summary.sort((a, b) => String(a._id).localeCompare(String(b._id)));
      }
    } catch (err) {
      console.warn('Customer statement party list merge skipped:', err.message);
    }

    res.json({ success: true, data: summary });
  })
);

router.get('/reports/customer-statement/:customerName',
  authorize('super_admin', 'admin', 'finance_manager'),
  asyncHandler(async (req, res) => {
    // :customerName is URL-encoded customer.name (the embedded field)
    const customerName = decodeURIComponent(req.params.customerName);
    const { fromDate, toDate } = req.query;
    const { q } = await financeScope(req);

    const matchFilter = q({ 'customer.name': customerName });
    if (fromDate || toDate) {
      matchFilter.createdAt = {};
      if (fromDate) matchFilter.createdAt.$gte = new Date(fromDate);
      if (toDate) matchFilter.createdAt.$lte = new Date(toDate);
    }

    const invoices = await AccountsReceivable.find(matchFilter).sort({ createdAt: 1 });

    // Manual JE lines tagged to this customer (Accounts Receivable party)
    let partyJournalEntries = [];
    let customerIds = [];
    try {
      const SalesCustomer = require('../models/sales/SalesCustomer');
      const customerDocs = await SalesCustomer.find({
        name: new RegExp(`^${customerName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i')
      })
        .select('_id email')
        .lean();
      customerIds = customerDocs.map((c) => c._id);
      if (customerIds.length) {
        const jeMatch = {
          status: 'posted',
          lines: {
            $elemMatch: {
              partyType: 'Customer',
              party: { $in: customerIds }
            }
          }
        };
        const scoped = q(jeMatch);
        if (fromDate || toDate) {
          scoped.date = {};
          if (fromDate) scoped.date.$gte = new Date(fromDate);
          if (toDate) scoped.date.$lte = new Date(toDate);
        }
        partyJournalEntries = await JournalEntry.find(scoped)
          .select('entryNumber date description reference lines status totalDebits totalCredits')
          .sort({ date: 1 })
          .lean();
      }
    } catch (err) {
      console.warn('Customer statement party JE lookup skipped:', err.message);
    }

    const stmtPaid = (i) => Number(i.amountPaid || i.paidAmount || 0);
    const totalInvoiced = invoices.reduce((s, i) => s + (i.totalAmount || i.amount || 0), 0);
    const totalReceived = invoices.reduce((s, i) => s + stmtPaid(i), 0);
    const totalBalance = invoices.reduce(
      (s, i) => s + ((i.totalAmount || i.amount || 0) - stmtPaid(i)),
      0
    );

    const customerIdSet = new Set(customerIds.map((id) => String(id)));
    let partyDebits = 0;
    let partyCredits = 0;
    partyJournalEntries.forEach((je) => {
      (je.lines || []).forEach((line) => {
        if (String(line.partyType) !== 'Customer') return;
        if (!customerIdSet.has(String(line.party))) return;
        partyDebits += Number(line.debit) || 0;
        partyCredits += Number(line.credit) || 0;
      });
    });

    res.json({
      success: true,
      data: {
        customer: {
          name: customerName,
          email: invoices[0]?.customer?.email || ''
        },
        invoices,
        journalEntries: partyJournalEntries.map((je) => ({
          _id: je._id,
          entryNumber: je.entryNumber,
          date: je.date,
          description: je.description,
          reference: je.reference,
          totalDebits: je.totalDebits,
          totalCredits: je.totalCredits,
          debit: (je.lines || []).reduce((s, l) => {
            if (String(l.partyType) !== 'Customer' || !customerIdSet.has(String(l.party))) return s;
            return s + (Number(l.debit) || 0);
          }, 0),
          credit: (je.lines || []).reduce((s, l) => {
            if (String(l.partyType) !== 'Customer' || !customerIdSet.has(String(l.party))) return s;
            return s + (Number(l.credit) || 0);
          }, 0)
        })),
        summary: {
          totalInvoiced: Math.round(totalInvoiced * 100) / 100,
          totalReceived: Math.round(totalReceived * 100) / 100,
          totalBalance: Math.round(totalBalance * 100) / 100,
          partyJournalDebits: Math.round(partyDebits * 100) / 100,
          partyJournalCredits: Math.round(partyCredits * 100) / 100
        }
      }
    });
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// BANK RECONCILIATION REPORT
// ─────────────────────────────────────────────────────────────────────────────
router.get('/reports/bank-reconciliation',
  authorize('super_admin', 'admin', 'finance_manager'),
  asyncHandler(async (req, res) => {
    /**
     * Unpresented = Trial Balance account ledger for the selected bank (same engine as
     * GET /general-ledger/account/:id) minus rows cleared as-of the As of Date.
     * Period Activity still uses clearance dates within From/To.
     */
    const {
      accountId,
      asOfDate,
      fromDate,
      toDate,
      ledgerFromDate,
      includePeriodRows: includePeriodRowsRaw
    } = req.query;
    if (!accountId) {
      return res.status(400).json({ success: false, message: 'Bank account is required' });
    }
    // Default true — phase-1 As-of Generate uses includePeriodRows=0 for a faster Unpresented response
    const includePeriodRows = !(
      String(includePeriodRowsRaw || '') === '0'
      || String(includePeriodRowsRaw || '').toLowerCase() === 'false'
    );

    let asOf = new Date();
    if (asOfDate) {
      asOf = new Date(asOfDate);
      if (Number.isNaN(asOf.getTime())) {
        return res.status(400).json({ success: false, message: 'Invalid As of Date' });
      }
      asOf.setHours(23, 59, 59, 999);
    } else {
      asOf.setHours(23, 59, 59, 999);
    }

    // Period Activity window (Date.From / Date.To)
    let periodStartDate = fromDate
      ? new Date(fromDate)
      : new Date(asOf.getFullYear(), asOf.getMonth(), 1);
    periodStartDate.setHours(0, 0, 0, 0);

    let periodEndDate = toDate ? new Date(toDate) : new Date(asOf);
    periodEndDate.setHours(23, 59, 59, 999);

    // Unpresented / Bank Ledger window (hard default: 2000-01-01 → As of)
    let ledgerFrom = ledgerFromDate
      ? new Date(ledgerFromDate)
      : (fromDate ? new Date(fromDate) : new Date('2000-01-01T00:00:00.000Z'));
    if (Number.isNaN(ledgerFrom.getTime())) {
      ledgerFrom = new Date('2000-01-01T00:00:00.000Z');
    }
    ledgerFrom.setHours(0, 0, 0, 0);

    const { q, companyId } = await financeScope(req);
    const OBJECT_ID_RE = /^[0-9a-fA-F]{24}$/;
    if (!OBJECT_ID_RE.test(String(accountId))) {
      return res.status(400).json({ success: false, message: 'Invalid bank account id' });
    }

    const selectedAccountObj = await Account.findById(accountId).lean();
    if (!selectedAccountObj) {
      return res.status(404).json({ success: false, message: 'Bank account not found' });
    }

    // Dropdown: bank/cash COA for this company (exclude later on client if needed)
    const coaBankAccounts = await Account.find(
      q({
        $or: [
          { type: 'Asset' },
          { category: { $regex: /cash|bank|current/i } },
          { detailType: { $regex: /cash|bank/i } },
          { accountCode: 'BANK' },
          { accountCode: 'CASH' }
        ]
      })
    ).sort({ accountNumber: 1 }).lean();

    const isUselessReference = (ref) => {
      const u = String(ref || '').trim().toUpperCase();
      if (!u || u === '—' || u === '-' || u === 'N/A' || u === 'NA' || u === 'NULL') return true;
      if (u === 'EXCEL IMPORT' || u === 'EXCEL' || u === 'IMPORT') return true;
      return false;
    };

    const cleanReference = (ref, vrNo) => {
      let r = String(ref || '').trim();
      if (isUselessReference(r)) return '—';
      const u = r.toUpperCase();
      // If reference is only a duplicate of VrNo, still show it (accountants expect a value)
      if (u === String(vrNo || '').toUpperCase()) return r;
      return r;
    };

    const resolveClearance = (gle, asOfTime) => {
      const markedCleared = Boolean(gle.clearanceStatus === 'cleared' || gle.isReconciled);
      const clearDateRaw = gle.clearedAt || gle.reconciledAt || null;
      const clearDate = clearDateRaw || (markedCleared && gle.date ? gle.date : null);
      const clearedAtTime = clearDate ? new Date(clearDate).getTime() : NaN;
      const isClearedAsOf = Boolean(
        markedCleared &&
        !Number.isNaN(clearedAtTime) &&
        clearedAtTime <= asOfTime
      );
      return { clearDate, isClearedAsOf };
    };

    const getClearingSortTime = (t) => {
      if (t.clearingDate) {
        const cd = new Date(t.clearingDate).getTime();
        if (!Number.isNaN(cd)) return cd;
      }
      if (t.date) {
        const d = new Date(t.date).getTime();
        if (!Number.isNaN(d)) return d;
      }
      return 0;
    };

    // ── Same source as Trial Balance ledger drill-down ──────────────────────
    // Window = ledgerFrom (default 01/01/2000) → As of
    const ledgerAsOf = await GeneralLedger.getAccountLedger(
      accountId,
      ledgerFrom,
      asOf,
      companyId || null
    );
    const ledgerEntries = Array.isArray(ledgerAsOf?.entries) ? ledgerAsOf.entries : [];
    // Book balance as-of = opening before From + period movement (TB closing)
    const netGlBalance = Math.round((Number(ledgerAsOf?.closingBalance) || 0) * 100) / 100;

    // Enrich JE extras needed by BR UI (attachments / signed) — not loaded by TB populate
    const jeIds = [
      ...new Set(
        ledgerEntries
          .map((e) => String(e.journalEntry?._id || e.journalEntry || ''))
          .filter((id) => OBJECT_ID_RE.test(id))
      )
    ];
    const jeExtraMap = new Map();
    if (jeIds.length) {
      const jes = await JournalEntry.find({ _id: { $in: jeIds } })
        .select('attachments signedDocumentStatus signedDocumentAt signedBySignatory status')
        .lean();
      jes.forEach((je) => jeExtraMap.set(String(je._id), je));
    }

    // Clearance may already be on JE-ledger rows (incl. installment aggregates); also load by ObjectId
    const realGlIds = [
      ...new Set(
        ledgerEntries.flatMap((e) => {
          const ids = Array.isArray(e.linkedGlIds) ? e.linkedGlIds.map(String) : [];
          const self = String(e._id || '');
          if (OBJECT_ID_RE.test(self)) ids.push(self);
          return ids.filter((id) => OBJECT_ID_RE.test(id));
        })
      )
    ];
    const clearanceById = new Map();
    if (realGlIds.length) {
      const clearanceRows = await GeneralLedger.find({ _id: { $in: realGlIds } })
        .select('_id clearanceStatus clearedAt isReconciled reconciledAt date')
        .lean();
      clearanceRows.forEach((r) => clearanceById.set(String(r._id), r));
    }

    const asOfTime = asOf.getTime();
    const mapLedgerRowToTxn = (gle) => {
      const je = gle.journalEntry && typeof gle.journalEntry === 'object' ? gle.journalEntry : {};
      const jeId = je._id ? String(je._id) : (gle.journalEntry ? String(gle.journalEntry) : '');
      const jeExtra = jeId ? jeExtraMap.get(jeId) || {} : {};
      const acc = gle.account && typeof gle.account === 'object' ? gle.account : selectedAccountObj;
      const debit = Number(gle.debit) || 0;
      const credit = Number(gle.credit) || 0;
      const isCredit = credit > 0;
      const amt = isCredit ? credit : debit;
      const vrNo = gle.entryNumber || je.entryNumber || '—';
      const glId = String(gle._id || '');
      const linkedGlIds = Array.isArray(gle.linkedGlIds)
        ? gle.linkedGlIds.map(String).filter((id) => OBJECT_ID_RE.test(id))
        : (OBJECT_ID_RE.test(glId) ? [glId] : []);
      // Prefer pre-aggregated clearance from getAccountLedger; else lookup by primary GL id
      const clearanceSrc = (gle.clearanceStatus || gle.clearedAt || gle.isReconciled != null)
        ? gle
        : (clearanceById.get(glId) || gle);
      const { clearDate, isClearedAsOf } = resolveClearance(clearanceSrc, asOfTime);

      // Prefer ledger row ref (may already be GL cheque from attachGlClearance); skip JE placeholders
      const rawRef = !isUselessReference(gle.reference)
        ? gle.reference
        : (!isUselessReference(je.reference) ? je.reference : '');

      return {
        _id: glId,
        linkedGlIds,
        journalEntryId: OBJECT_ID_RE.test(jeId) ? jeId : null,
        accountId: String(acc?._id || accountId),
        date: gle.date,
        vrNo,
        narration: gle.description || je.description || acc?.name || 'Bank Transaction',
        reference: cleanReference(rawRef, vrNo),
        debit,
        credit,
        amount: amt,
        type: isCredit ? 'Cr' : 'Dr',
        isCleared: isClearedAsOf,
        clearanceStatus: isClearedAsOf ? 'cleared' : (clearanceSrc.clearanceStatus || 'pending'),
        clearingDate: clearDate,
        attachments: jeExtra.attachments || [],
        signedDocumentStatus: jeExtra.signedDocumentStatus || 'not_signed',
        signedDocumentAt: jeExtra.signedDocumentAt || null,
        signedBySignatory: jeExtra.signedBySignatory || null,
        status: jeExtra.status || gle.status || 'posted',
        accountName: acc?.name || selectedAccountObj.name || 'Bank Account',
        accountNumber: acc?.accountNumber || selectedAccountObj.accountNumber || ''
      };
    };

    /**
     * Installment BPVs (e.g. BPV-2-20260701): one JE bank line, many GL rows each with its own
     * cheque. Pre-9AM Unpresented listed each GL cheque separately. JE-ledger collapsed them into
     * one row with joined refs — expand back to one Unpresented row per installment GL.
     */
    const moneyEqBr = (a, b) => Math.abs(Number(a || 0) - Number(b || 0)) < 0.02;
    const expandInstallmentLedgerEntries = async (entries) => {
      const multiIds = [
        ...new Set(
          entries.flatMap((e) =>
            (Array.isArray(e.linkedGlIds) ? e.linkedGlIds : [])
              .map(String)
              .filter((id) => OBJECT_ID_RE.test(id))
          )
        )
      ];
      // Only fetch when a row claims multiple linked GLs
      const needsExpand = entries.some(
        (e) => Array.isArray(e.linkedGlIds) && e.linkedGlIds.length > 1
      );
      if (!needsExpand) return entries;

      const glById = new Map();
      if (multiIds.length) {
        const docs = await GeneralLedger.find({ _id: { $in: multiIds } })
          .select('_id debit credit reference clearanceStatus clearedAt isReconciled reconciledAt date description')
          .lean();
        docs.forEach((d) => glById.set(String(d._id), d));
      }

      const out = [];
      for (const e of entries) {
        const ids = (Array.isArray(e.linkedGlIds) ? e.linkedGlIds : [])
          .map(String)
          .filter((id) => OBJECT_ID_RE.test(id));
        if (ids.length <= 1) {
          out.push(e);
          continue;
        }
        const gls = ids.map((id) => glById.get(id)).filter(Boolean);
        const lineDebit = Number(e.debit) || 0;
        const lineCredit = Number(e.credit) || 0;
        let installmentSet = null;
        if (lineCredit > 0) {
          const credits = gls.filter((g) => Number(g.credit) > 0 && !(Number(g.debit) > 0));
          const sum = credits.reduce((s, g) => s + (Number(g.credit) || 0), 0);
          if (credits.length > 1 && moneyEqBr(sum, lineCredit)) installmentSet = credits;
        } else if (lineDebit > 0) {
          const debits = gls.filter((g) => Number(g.debit) > 0 && !(Number(g.credit) > 0));
          const sum = debits.reduce((s, g) => s + (Number(g.debit) || 0), 0);
          if (debits.length > 1 && moneyEqBr(sum, lineDebit)) installmentSet = debits;
        }
        if (!installmentSet) {
          out.push(e);
          continue;
        }
        for (const g of installmentSet) {
          out.push({
            ...e,
            _id: g._id,
            linkedGlIds: [String(g._id)],
            debit: Number(g.debit) || 0,
            credit: Number(g.credit) || 0,
            reference: g.reference || '',
            description: g.description || e.description,
            clearanceStatus: g.clearanceStatus,
            clearedAt: g.clearedAt,
            isReconciled: g.isReconciled,
            reconciledAt: g.reconciledAt
          });
        }
      }
      return out;
    };

    const ledgerEntriesForBr = await expandInstallmentLedgerEntries(ledgerEntries);
    const allLedgerTxns = ledgerEntriesForBr.map(mapLedgerRowToTxn);
    allLedgerTxns.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    // Unpresented = uncleared only (JE-dated ledger, same source as TB). Cleared move to Period Activity.
    const unpresentedTxns = allLedgerTxns.filter((t) => !t.isCleared);
    const unpresentedTotal = unpresentedTxns.reduce(
      (s, t) => s + (t.type === 'Cr' ? -t.amount : t.amount),
      0
    );

    let reconciledUpTo = new Date(asOf);
    if (unpresentedTxns.length > 0) {
      const oldestUnpresentedDate = new Date(
        Math.min(...unpresentedTxns.map((t) => new Date(t.date).getTime()))
      );
      reconciledUpTo = new Date(oldestUnpresentedDate.getTime() - 24 * 60 * 60 * 1000);
    } else if (allLedgerTxns.length > 0) {
      const latestTxnDate = new Date(
        Math.max(...allLedgerTxns.map((t) => new Date(t.date).getTime()))
      );
      reconciledUpTo = new Date(Math.min(asOf.getTime(), latestTxnDate.getTime()));
    }

    // ── Period Activity: cleared GL rows by clearing date (From/To) ─────────
    const clearedGlQuery = {
      account: accountId,
      status: 'posted',
      $or: [
        { clearanceStatus: 'cleared' },
        { isReconciled: true }
      ]
    };
    if (companyId) clearedGlQuery.companyId = companyId;

    let openingBalance = 0;
    let periodTransactions = [];
    let periodTotalCount = 0;
    let statementTotal = 0;
    // Top summary: cleared activity with clearing date ≤ As of (independent of Period From/To filters)
    let bankStatementBalance = 0;
    let periodDeferred = false;

    if (!includePeriodRows) {
      // Fast path: lean totals only (no populate / no period row payload)
      const clearedLean = await GeneralLedger.find(clearedGlQuery)
        .select('debit credit clearedAt reconciledAt clearanceStatus isReconciled date')
        .lean();

      let openingNet = 0;
      let periodNet = 0;
      let asOfClearedNet = 0;
      let inPeriodCount = 0;
      for (const gle of clearedLean) {
        const { clearDate } = resolveClearance(gle, Number.MAX_SAFE_INTEGER);
        if (!clearDate) continue;
        const cDate = new Date(clearDate);
        const net = (Number(gle.debit) || 0) - (Number(gle.credit) || 0);
        if (cDate <= asOf) {
          asOfClearedNet += net;
        }
        if (cDate < periodStartDate) {
          openingNet += net;
        } else if (cDate <= periodEndDate) {
          periodNet += net;
          inPeriodCount += 1;
        }
      }
      openingBalance = openingNet;
      periodTotalCount = inPeriodCount;
      statementTotal = Math.round((openingBalance + periodNet) * 100) / 100;
      bankStatementBalance = Math.round(asOfClearedNet * 100) / 100;
      periodTransactions = [];
      periodDeferred = true;
    } else {
      const clearedGlRows = await GeneralLedger.find(clearedGlQuery)
        .populate('account', 'name accountNumber')
        .populate('journalEntry', 'entryNumber reference description attachments signedDocumentStatus signedDocumentAt signedBySignatory status')
        .sort({ date: 1, entryNumber: 1 })
        .lean();

      const clearedTxns = clearedGlRows.map((gle) => {
        const { clearDate } = resolveClearance(gle, Number.MAX_SAFE_INTEGER);
        const je = gle.journalEntry || {};
        const debit = Number(gle.debit) || 0;
        const credit = Number(gle.credit) || 0;
        const isCredit = credit > 0;
        const amt = isCredit ? credit : debit;
        const vrNo = gle.entryNumber || je.entryNumber || '—';
        return {
          _id: String(gle._id),
          journalEntryId: je._id ? String(je._id) : null,
          accountId: String(gle.account?._id || accountId),
          date: gle.date,
          vrNo,
          narration: gle.description || je.description || gle.account?.name || 'Bank Transaction',
          reference: cleanReference(gle.reference || je.reference, vrNo),
          debit,
          credit,
          amount: amt,
          type: isCredit ? 'Cr' : 'Dr',
          isCleared: true,
          clearanceStatus: 'cleared',
          clearingDate: clearDate,
          attachments: je.attachments || [],
          signedDocumentStatus: je.signedDocumentStatus || 'not_signed',
          signedDocumentAt: je.signedDocumentAt || null,
          signedBySignatory: je.signedBySignatory || null,
          status: je.status || gle.status || 'posted',
          accountName: gle.account?.name || selectedAccountObj.name || 'Bank Account',
          accountNumber: gle.account?.accountNumber || selectedAccountObj.accountNumber || ''
        };
      }).filter((t) => t.clearingDate);

      const openingClearedTxns = clearedTxns.filter(
        (t) => new Date(t.clearingDate) < periodStartDate
      );
      openingBalance = openingClearedTxns.reduce(
        (s, r) => s + (Number(r.debit) || 0) - (Number(r.credit) || 0),
        0
      );

      periodTransactions = clearedTxns.filter((t) => {
        const cDate = new Date(t.clearingDate);
        return cDate >= periodStartDate && cDate <= periodEndDate;
      });
      periodTransactions.sort((a, b) => getClearingSortTime(a) - getClearingSortTime(b));

      const periodNetChange = periodTransactions.reduce(
        (s, r) => s + (Number(r.debit) || 0) - (Number(r.credit) || 0),
        0
      );
      // Period section footer only (Date.From → Date.To)
      statementTotal = Math.round((openingBalance + periodNetChange) * 100) / 100;
      periodTotalCount = periodTransactions.length;

      // Top Bank Statement: all cleared through As of Date (ignores Period From/To filters)
      bankStatementBalance = Math.round(
        clearedTxns
          .filter((t) => new Date(t.clearingDate) <= asOf)
          .reduce((s, r) => s + (Number(r.debit) || 0) - (Number(r.credit) || 0), 0) * 100
      ) / 100;
    }
    const unpresentedTotalCount = unpresentedTxns.length;

    res.json({
      success: true,
      data: {
        asOfDate: asOf,
        fromDate: periodStartDate,
        toDate: periodEndDate,
        ledgerFromDate: ledgerFrom,
        reconciledUpTo,
        source: 'trial-balance-ledger',
        selectedAccount: {
          _id: selectedAccountObj._id,
          accountName: selectedAccountObj.name,
          accountNumber: selectedAccountObj.accountNumber
        },
        glBalance: netGlBalance,
        glBalanceType: netGlBalance >= 0 ? 'Dr' : 'Cr',
        // Uncleared cheques / payments only (not TB period Debit−Credit)
        difference: Math.round(unpresentedTotal * 100) / 100,
        differenceType: unpresentedTotal >= 0 ? 'Dr' : 'Cr',
        bankStatementBalance,
        bankStatementBalanceType: bankStatementBalance >= 0 ? 'Dr' : 'Cr',
        unpresentedTransactions: unpresentedTxns,
        unpresentedTotal: Math.round(unpresentedTotal * 100) / 100,
        unpresentedTotalCount,
        openingBalance: Math.round(openingBalance * 100) / 100,
        openingBalanceType: openingBalance >= 0 ? 'Dr' : 'Cr',
        periodTransactions,
        periodTotalCount,
        periodDeferred,
        statementTotal: Math.round(statementTotal * 100) / 100,
        statementTotalType: statementTotal >= 0 ? 'Dr' : 'Cr',
        bankAccounts: coaBankAccounts.map((a) => ({
          _id: a._id,
          accountName: a.name,
          accountNumber: a.accountNumber,
          bankName: a.category || a.detailType || 'Bank'
        }))
      }
    });
  })
);

// Mark transaction as reconciled — per GL row only (never whole voucher).
router.post('/reports/bank-reconciliation/reconcile',
  authorize('super_admin', 'admin', 'finance_manager'),
  asyncHandler(async (req, res) => {
    const {
      transactionIds,
      clearanceStatus,
      clearedAt,
      debit,
      credit,
      amount,
      type,
      journalEntryId,
      accountId,
      linkedGlIds: linkedGlIdsBody
    } = req.body;
    const isCleared = clearanceStatus === 'cleared';
    const hasValidDate = clearedAt && !Number.isNaN(new Date(clearedAt).getTime());
    // Always persist a clearance date when marking cleared (never leave null → Unpresented ghost)
    const clearDate = isCleared
      ? (hasValidDate ? new Date(clearedAt) : new Date())
      : null;
    const OBJECT_ID_RE = /^[0-9a-fA-F]{24}$/;
    const mongoose = require('mongoose');

    if (!Array.isArray(transactionIds) || transactionIds.length === 0) {
      return res.status(400).json({ success: false, message: 'transactionIds required' });
    }

    const GeneralLedger = require('../models/finance/GeneralLedger');
    const JournalEntry = require('../models/finance/JournalEntry');

    const moneyEq = (a, b) => Math.abs(Number(a || 0) - Number(b || 0)) < 0.02;
    const wantDebit = Number(debit) || 0;
    const wantCredit = Number(credit) || 0;
    const wantAmt = Number(amount) || 0;
    const wantType = String(type || '').trim();

    const glUpdate = isCleared
      ? {
          isReconciled: true,
          reconciledAt: clearDate,
          clearanceStatus: 'cleared',
          clearedAt: clearDate
        }
      : {
          isReconciled: false,
          reconciledAt: null,
          clearanceStatus: clearanceStatus || 'pending',
          clearedAt: null
        };

    const pickGlAmong = (candidates = []) => {
      if (!candidates.length) return null;
      // Never pick the only GL without matching Dr/Cr — after Dr is cleared, only Dr GL
      // exists; clearing Cr must create/update the Cr line, not reuse Dr.
      const matched = candidates.filter((g) => {
        const gDebit = Number(g.debit) || 0;
        const gCredit = Number(g.credit) || 0;
        if (wantDebit > 0 || wantCredit > 0) {
          return moneyEq(gDebit, wantDebit) && moneyEq(gCredit, wantCredit);
        }
        if (wantType === 'Cr') return gCredit > 0 && (!wantAmt || moneyEq(gCredit, wantAmt));
        if (wantType === 'Dr') return gDebit > 0 && (!wantAmt || moneyEq(gDebit, wantAmt));
        return false;
      });
      return matched.length === 1 ? matched[0] : null;
    };

    /** When one JE line was split into installment GLs, update the whole set. */
    const pickInstallmentGlSet = (candidates = []) => {
      if (!candidates.length) return null;
      if (wantCredit > 0) {
        const credits = candidates.filter((g) => Number(g.credit) > 0 && !(Number(g.debit) > 0));
        const sum = credits.reduce((s, g) => s + (Number(g.credit) || 0), 0);
        if (credits.length > 1 && moneyEq(sum, wantCredit)) return credits;
      }
      if (wantDebit > 0) {
        const debits = candidates.filter((g) => Number(g.debit) > 0 && !(Number(g.credit) > 0));
        const sum = debits.reduce((s, g) => s + (Number(g.debit) || 0), 0);
        if (debits.length > 1 && moneyEq(sum, wantDebit)) return debits;
      }
      return null;
    };

    const updateGlSet = async (rows) => {
      if (!rows?.length) return [];
      const ids = rows.map((r) => r._id);
      await GeneralLedger.updateMany({ _id: { $in: ids } }, { $set: glUpdate });
      return ids.map((id) => String(id));
    };

    const resolveOneId = async (rawId) => {
      const id = String(rawId || '').trim();
      if (!id) return null;

      // 0) Explicit linked installment GL set from client
      const bodyLinked = Array.isArray(linkedGlIdsBody)
        ? linkedGlIdsBody.map(String).filter((x) => OBJECT_ID_RE.test(x))
        : [];
      if (bodyLinked.length > 1 && (OBJECT_ID_RE.test(id) ? bodyLinked.includes(id) : true)) {
        const linkedDocs = await GeneralLedger.find({ _id: { $in: bodyLinked } })
          .select('_id debit credit')
          .lean();
        if (linkedDocs.length) {
          const updated = await updateGlSet(linkedDocs);
          if (updated.length) return updated[0];
        }
      }

      // 1) Plain GL ObjectId — update directly (do not require a prior find)
      if (OBJECT_ID_RE.test(id)) {
        // If this id is one of an installment set for the voucher, clear the whole set
        const jeIdEarly = journalEntryId && OBJECT_ID_RE.test(String(journalEntryId)) ? String(journalEntryId) : null;
        if (jeIdEarly) {
          const q = { journalEntry: jeIdEarly };
          if (accountId && OBJECT_ID_RE.test(String(accountId))) q.account = String(accountId);
          const candidates = await GeneralLedger.find(q).select('_id debit credit').lean();
          const installment = pickInstallmentGlSet(candidates);
          if (installment && installment.some((g) => String(g._id) === id)) {
            const updated = await updateGlSet(installment);
            if (updated.length) return updated[0];
          }
        }

        const direct = await GeneralLedger.updateOne({ _id: id }, { $set: glUpdate });
        if ((direct.matchedCount || direct.n) > 0) return id;

        // 2) Fallback: same voucher + amount (account optional)
        const jeId = journalEntryId && OBJECT_ID_RE.test(String(journalEntryId)) ? String(journalEntryId) : null;
        if (jeId) {
          const q = { journalEntry: jeId };
          if (accountId && OBJECT_ID_RE.test(String(accountId))) q.account = String(accountId);
          let candidates = await GeneralLedger.find(q).select('_id debit credit').lean();
          let chosen = pickGlAmong(candidates);
          if (!chosen) {
            const installment = pickInstallmentGlSet(candidates);
            if (installment) {
              const updated = await updateGlSet(installment);
              if (updated.length) return updated[0];
            }
          }
          if (!chosen) {
            candidates = await GeneralLedger.find({ journalEntry: jeId }).select('_id debit credit').lean();
            chosen = pickGlAmong(candidates);
            if (!chosen) {
              const installment = pickInstallmentGlSet(candidates);
              if (installment) {
                const updated = await updateGlSet(installment);
                if (updated.length) return updated[0];
              }
            }
          }
          if (chosen) {
            await GeneralLedger.updateOne({ _id: chosen._id }, { $set: glUpdate });
            return String(chosen._id);
          }
        }
        return null;
      }

      // 3) Rich composite: jeId-accountId-lineIndex-Dr|Cr-amount
      const rich = id.match(/^([0-9a-fA-F]{24})-([0-9a-fA-F]{24})-(\d+)-(Dr|Cr)-([0-9.]+)$/);
      const legacy = !rich && id.match(/^([0-9a-fA-F]{24})-([0-9a-fA-F]{24})$/);
      if (rich || legacy) {
        const jeId = rich ? rich[1] : legacy[1];
        const accId = rich ? rich[2] : legacy[2];
        let candidates = await GeneralLedger.find({
          journalEntry: jeId,
          account: accId
        }).select('_id debit credit').lean();

        let chosen = null;
        if (rich) {
          const lineType = rich[4];
          const lineAmt = Number(rich[5]);
          const typed = candidates.filter((g) =>
            lineType === 'Cr'
              ? moneyEq(g.credit, lineAmt)
              : moneyEq(g.debit, lineAmt)
          );
          // Only accept an exact Dr/Cr match — never fall back to an unrelated lone GL
          chosen = typed.length === 1 ? typed[0] : null;
        } else {
          chosen = pickGlAmong(candidates);
        }

        if (!chosen) {
          candidates = await GeneralLedger.find({ journalEntry: jeId }).select('_id debit credit').lean();
          if (rich) {
            const lineType = rich[4];
            const lineAmt = Number(rich[5]);
            const typed = candidates.filter((g) =>
              lineType === 'Cr'
                ? moneyEq(g.credit, lineAmt)
                : moneyEq(g.debit, lineAmt)
            );
            chosen = typed.length === 1 ? typed[0] : null;
          } else {
            chosen = pickGlAmong(candidates);
          }
        }

        if (chosen) {
          await GeneralLedger.updateOne({ _id: chosen._id }, { $set: glUpdate });
          return String(chosen._id);
        }

        // 4) No GL yet — create one from the journal line so this row can clear independently
        const je = await JournalEntry.findById(jeId);
        if (je) {
          const lines = Array.isArray(je.lines) ? je.lines : [];
          let line = null;
          if (rich) {
            const idx = Number(rich[3]);
            const lineType = rich[4];
            const lineAmt = Number(rich[5]);
            line = lines[idx] || null;
            if (line) {
              const accMatch = String(line.account?._id || line.account) === accId;
              const amtMatch = lineType === 'Cr'
                ? moneyEq(line.credit, lineAmt)
                : moneyEq(line.debit, lineAmt);
              if (!accMatch || !amtMatch) line = null;
            }
          }
          if (!line) {
            line = lines.find((l) => {
              const accMatch = String(l.account?._id || l.account) === accId;
              if (!accMatch) return false;
              if (wantDebit > 0 || wantCredit > 0) {
                return moneyEq(l.debit, wantDebit) && moneyEq(l.credit, wantCredit);
              }
              if (wantType === 'Cr') return moneyEq(l.credit, wantAmt || l.credit);
              if (wantType === 'Dr') return moneyEq(l.debit, wantAmt || l.debit);
              return false;
            }) || null;
          }
          if (line) {
            try {
              const userId = req.user?.id || req.user?._id;
              if (!userId) {
                console.error('Bank recon: missing req.user for GL create');
                return null;
              }
              const created = await GeneralLedger.create({
                companyId: je.companyId || null,
                journalEntry: je._id,
                account: line.account,
                date: je.date || new Date(),
                entryNumber: je.entryNumber || je.reference || 'N/A',
                reference: je.reference || '',
                description: line.description || je.description || 'Bank transaction',
                debit: Number(line.debit) || 0,
                credit: Number(line.credit) || 0,
                department: 'Finance',
                module: je.module || 'finance',
                referenceType: je.referenceType || 'manual',
                createdBy: userId,
                status: 'posted',
                clearanceStatus: glUpdate.clearanceStatus,
                clearedAt: glUpdate.clearedAt,
                isReconciled: glUpdate.isReconciled,
                reconciledAt: glUpdate.reconciledAt
              });
              return String(created._id);
            } catch (createErr) {
              console.error('Bank recon: failed to create GL for clearance', createErr.message);
            }
          }
        }
      }

      return null;
    };

    const updatedGlIds = [];
    for (const raw of transactionIds) {
      const resolved = await resolveOneId(raw);
      if (resolved) updatedGlIds.push(resolved);
    }

    // Last resort: ignore row id, match voucher + Dr/Cr amounts from the request body
    if (updatedGlIds.length === 0 && journalEntryId && OBJECT_ID_RE.test(String(journalEntryId))) {
      const jeId = String(journalEntryId);
      let candidates = await GeneralLedger.find({ journalEntry: jeId }).select('_id debit credit').lean();
      if (accountId && OBJECT_ID_RE.test(String(accountId))) {
        const scoped = await GeneralLedger.find({
          journalEntry: jeId,
          account: String(accountId)
        }).select('_id debit credit').lean();
        if (scoped.length) candidates = scoped;
      }
      let chosen = pickGlAmong(candidates);
      if (chosen) {
        await GeneralLedger.updateOne({ _id: chosen._id }, { $set: glUpdate });
        updatedGlIds.push(String(chosen._id));
      } else {
        const installment = pickInstallmentGlSet(candidates);
        if (installment) {
          const updated = await updateGlSet(installment);
          updatedGlIds.push(...updated);
        }
      }
      if (updatedGlIds.length === 0) {
        // Create missing GL from JE line (common for local imported CVs)
        const je = await JournalEntry.findById(jeId);
        const userId = req.user?.id || req.user?._id;
        if (je && userId) {
          const lines = Array.isArray(je.lines) ? je.lines : [];
          const line = lines.find((l) => {
            if (accountId && String(l.account?._id || l.account) !== String(accountId)) return false;
            if (wantDebit > 0 || wantCredit > 0) {
              return moneyEq(l.debit, wantDebit) && moneyEq(l.credit, wantCredit);
            }
            if (wantType === 'Cr') return Number(l.credit) > 0 && (!wantAmt || moneyEq(l.credit, wantAmt));
            if (wantType === 'Dr') return Number(l.debit) > 0 && (!wantAmt || moneyEq(l.debit, wantAmt));
            return false;
          });
          if (line) {
            try {
              const created = await GeneralLedger.create({
                companyId: je.companyId || null,
                journalEntry: je._id,
                account: line.account,
                date: je.date || new Date(),
                entryNumber: je.entryNumber || je.reference || 'N/A',
                reference: je.reference || '',
                description: line.description || je.description || 'Bank transaction',
                debit: Number(line.debit) || 0,
                credit: Number(line.credit) || 0,
                department: 'Finance',
                module: je.module || 'finance',
                referenceType: je.referenceType || 'manual',
                createdBy: userId,
                status: 'posted',
                clearanceStatus: glUpdate.clearanceStatus,
                clearedAt: glUpdate.clearedAt,
                isReconciled: glUpdate.isReconciled,
                reconciledAt: glUpdate.reconciledAt
              });
              updatedGlIds.push(String(created._id));
            } catch (createErr) {
              console.error('Bank recon last-resort GL create failed:', createErr.message);
            }
          }
        }
      }
    }

    // Optional: banking embedded txs (legacy)
    const bankingIds = transactionIds
      .map((id) => String(id || '').trim())
      .filter((id) => OBJECT_ID_RE.test(id));
    if (bankingIds.length > 0) {
      const bankingUpdate = {
        'transactions.$[elem].isReconciled': isCleared,
        'transactions.$[elem].reconciledDate': isCleared ? clearDate : null,
        'transactions.$[elem].clearanceStatus': isCleared ? 'cleared' : (clearanceStatus || 'pending'),
        'transactions.$[elem].clearedAt': isCleared ? clearDate : null
      };
    await Banking.updateMany(
        { 'transactions._id': { $in: bankingIds } },
        { $set: bankingUpdate },
        { arrayFilters: [{ 'elem._id': { $in: bankingIds } }] }
      );
      await Banking.updateMany(
        { _id: { $in: bankingIds } },
        {
          $set: {
            isReconciled: isCleared,
            reconciledAt: isCleared ? clearDate : null,
            reconciledBy: req.user.id,
            clearanceStatus: isCleared ? 'cleared' : (clearanceStatus || 'pending'),
            clearedAt: isCleared ? clearDate : null
          }
        }
      );
    }

    if (updatedGlIds.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Could not find that ledger line to clear. Refresh and try the specific Dr/Cr row again.'
      });
    }

    // Parent JE summary only — cleared when every GL line on voucher is cleared
    const targetGls = await GeneralLedger.find({
      _id: { $in: updatedGlIds }
    }).select('journalEntry').lean();
    const parentJeIds = Array.from(
      new Set(targetGls.map((g) => String(g.journalEntry || '')).filter(Boolean))
    );

    for (const parentJeId of parentJeIds) {
      const totalGLCount = await GeneralLedger.countDocuments({ journalEntry: parentJeId });
      const clearedGLCount = await GeneralLedger.countDocuments({
        journalEntry: parentJeId,
        $or: [{ clearanceStatus: 'cleared' }, { isReconciled: true }]
      });

      if (isCleared && totalGLCount > 0 && clearedGLCount === totalGLCount) {
        await JournalEntry.updateOne(
          { _id: parentJeId },
          {
            $set: {
              isReconciled: true,
              reconciledAt: clearDate,
              clearanceStatus: 'cleared',
              clearedAt: clearDate
            }
          }
        );
      } else {
        await JournalEntry.updateOne(
          { _id: parentJeId },
          {
            $set: {
              isReconciled: false,
              clearanceStatus: 'pending',
              ...(isCleared ? {} : { reconciledAt: null, clearedAt: null })
            }
          }
        );
      }
    }

    res.json({
      success: true,
      message: `${updatedGlIds.length} transaction(s) updated`,
      data: { updatedGlIds }
    });
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// COST CENTER P&L REPORT
// ─────────────────────────────────────────────────────────────────────────────
router.get('/reports/cost-center-pl',
  authorize('super_admin', 'admin', 'finance_manager'),
  asyncHandler(async (req, res) => {
    const mongoose = require('mongoose');
    const { costCenterId, fromDate, toDate } = req.query;
    const { jeMatch } = await financeScope(req);
    const match = jeMatch({ status: 'posted' });
    if (fromDate || toDate) {
      match.date = {};
      if (fromDate) match.date.$gte = new Date(fromDate);
      if (toDate) match.date.$lte = new Date(toDate);
    }

    const pipeline = [
      { $match: match },
      { $unwind: '$lines' },
      ...(costCenterId ? [{ $match: { 'lines.costCenter': new mongoose.Types.ObjectId(costCenterId) } }] : [{ $match: { 'lines.costCenter': { $exists: true, $ne: null } } }]),
      {
        $lookup: {
          from: 'accounts', localField: 'lines.account', foreignField: '_id', as: 'accDoc'
        }
      },
      { $unwind: '$accDoc' },
      {
        $group: {
          _id: { costCenter: '$lines.costCenter', accountType: '$accDoc.type' },
          totalDebit: { $sum: '$lines.debit' },
          totalCredit: { $sum: '$lines.credit' }
        }
      },
      {
        $lookup: {
          from: 'costcenters', localField: '_id.costCenter', foreignField: '_id', as: 'ccDoc'
        }
      },
      { $unwind: { path: '$ccDoc', preserveNullAndEmptyArrays: true } },
      {
        $group: {
          _id: '$_id.costCenter',
          costCenterName: { $first: '$ccDoc.name' },
          costCenterCode: { $first: '$ccDoc.code' },
          lines: {
            $push: {
              accountType: '$_id.accountType',
              totalDebit: '$totalDebit',
              totalCredit: '$totalCredit'
            }
          }
        }
      },
      { $sort: { costCenterName: 1 } }
    ];

    const data = await JournalEntry.aggregate(pipeline);
    res.json({ success: true, data });
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// BUDGET vs ACTUAL REPORT
// ─────────────────────────────────────────────────────────────────────────────
router.get('/reports/budget-vs-actual',
  authorize('super_admin', 'admin', 'finance_manager'),
  asyncHandler(async (req, res) => {
    const mongoose = require('mongoose');
    const CostCenter = require('../models/procurement/CostCenter');
    const { fromDate, toDate } = req.query;
    const { jeMatch } = await financeScope(req);

    const costCenters = await CostCenter.find({ isActive: true }).populate('department', 'name');

    const dateMatch = {};
    if (fromDate) dateMatch.$gte = new Date(fromDate);
    if (toDate) dateMatch.$lte = new Date(toDate);

    const actuals = await JournalEntry.aggregate([
      { $match: jeMatch({ status: 'posted', ...(Object.keys(dateMatch).length ? { date: dateMatch } : {}) }) },
      { $unwind: '$lines' },
      { $match: { 'lines.costCenter': { $exists: true, $ne: null } } },
      {
        $lookup: {
          from: 'accounts', localField: 'lines.account', foreignField: '_id', as: 'accDoc'
        }
      },
      { $unwind: '$accDoc' },
      { $match: { 'accDoc.type': { $in: ['expense', 'cost_of_goods_sold'] } } },
      {
        $group: {
          _id: '$lines.costCenter',
          actualExpenses: { $sum: '$lines.debit' }
        }
      }
    ]);

    const actualsMap = {};
    actuals.forEach(a => { actualsMap[a._id.toString()] = a.actualExpenses; });

    const result = costCenters.map(cc => {
      const actual = actualsMap[cc._id.toString()] || 0;
      const budget = cc.budget || 0;
      const variance = budget - actual;
      return {
        _id: cc._id,
        code: cc.code,
        name: cc.name,
        department: cc.department?.name,
        budgetPeriod: cc.budgetPeriod,
        budget: Math.round(budget * 100) / 100,
        actual: Math.round(actual * 100) / 100,
        variance: Math.round(variance * 100) / 100,
        variancePct: budget > 0 ? Math.round((variance / budget) * 10000) / 100 : null,
        overBudget: actual > budget
      };
    });

    const totalBudget = result.reduce((s, r) => s + r.budget, 0);
    const totalActual = result.reduce((s, r) => s + r.actual, 0);

    res.json({
      success: true,
      data: {
        rows: result,
        totals: {
          budget: Math.round(totalBudget * 100) / 100,
          actual: Math.round(totalActual * 100) / 100,
          variance: Math.round((totalBudget - totalActual) * 100) / 100
        }
      }
    });
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// AGED PAYABLES REPORT
// ─────────────────────────────────────────────────────────────────────────────
router.get('/reports/aged-payables',
  authorize('super_admin', 'admin', 'finance_manager'),
  asyncHandler(async (req, res) => {
    const asOf = req.query.asOfDate ? new Date(req.query.asOfDate) : new Date();
    const { q } = await financeScope(req);

    const bills = await AccountsPayable.find(q({ status: { $in: ['pending', 'partial'] } }))
      .populate('supplier', 'name code');

    const buckets = { current: 0, days1_30: 0, days31_60: 0, days61_90: 0, over90: 0 };
    const rows = bills.map(b => {
      const daysOutstanding = Math.floor((asOf - new Date(b.dueDate || b.createdAt)) / 86400000);
      const balance = b.balance || 0;
      let bucket = 'current';
      if (daysOutstanding > 90) bucket = 'over90';
      else if (daysOutstanding > 60) bucket = 'days61_90';
      else if (daysOutstanding > 30) bucket = 'days31_60';
      else if (daysOutstanding > 0) bucket = 'days1_30';
      buckets[bucket] = Math.round((buckets[bucket] + balance) * 100) / 100;
      return { _id: b._id, reference: b.referenceNumber, supplier: b.supplier, dueDate: b.dueDate, balance, daysOutstanding, bucket };
    });

    res.json({ success: true, data: { asOfDate: asOf, rows, buckets } });
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// AGED RECEIVABLES REPORT
// ─────────────────────────────────────────────────────────────────────────────
router.get('/reports/aged-receivables',
  authorize('super_admin', 'admin', 'finance_manager'),
  asyncHandler(async (req, res) => {
    const asOf = req.query.asOfDate ? new Date(req.query.asOfDate) : new Date();
    const { q } = await financeScope(req);

    const invoices = await AccountsReceivable.find(q({ status: { $in: ['pending', 'partial'] } }))
      .populate('customer', 'name code');

    const buckets = { current: 0, days1_30: 0, days31_60: 0, days61_90: 0, over90: 0 };
    const rows = invoices.map(inv => {
      const daysOutstanding = Math.floor((asOf - new Date(inv.dueDate || inv.createdAt)) / 86400000);
      const balance = inv.balance || 0;
      let bucket = 'current';
      if (daysOutstanding > 90) bucket = 'over90';
      else if (daysOutstanding > 60) bucket = 'days61_90';
      else if (daysOutstanding > 30) bucket = 'days31_60';
      else if (daysOutstanding > 0) bucket = 'days1_30';
      buckets[bucket] = Math.round((buckets[bucket] + balance) * 100) / 100;
      return { _id: inv._id, reference: inv.referenceNumber, customer: inv.customer, dueDate: inv.dueDate, balance, daysOutstanding, bucket };
    });

    res.json({ success: true, data: { asOfDate: asOf, rows, buckets } });
  })
);

// ═════════════════════════════════════════════════════════════════════════════
// CREDIT NOTES — Customer Refunds / Invoice Corrections
// ═════════════════════════════════════════════════════════════════════════════

// POST /api/finance/accounts-receivable/:id/credit-note
router.post('/accounts-receivable/:id/credit-note',
  authorize('super_admin', 'admin', 'finance_manager'),
  asyncHandler(async (req, res) => {
    const invoice = await AccountsReceivable.findById(req.params.id);
    if (!invoice) return res.status(404).json({ success: false, message: 'Invoice not found' });

    const { amount, reason, date } = req.body;
    if (!amount || amount <= 0) return res.status(400).json({ success: false, message: 'Credit note amount is required' });

    const creditAmount = Math.min(Number(amount), invoice.totalAmount);
    const creditNoteNumber = `CN-${invoice.invoiceNumber}`;

    // Create a negative AR entry (Credit Note)
    const creditNote = new AccountsReceivable({
      invoiceNumber: creditNoteNumber,
      customer: { name: invoice.customer?.name || 'Customer', email: invoice.customer?.email || '', customerId: invoice.customer?.customerId },
      invoiceDate: date ? new Date(date) : new Date(),
      dueDate: date ? new Date(date) : new Date(),
      totalAmount: -creditAmount,
      subtotal: -creditAmount,
      status: 'paid',
      department: invoice.department,
      module: invoice.module,
      referenceId: invoice._id,
      referenceType: 'invoice',
      lineItems: [{ description: reason || `Credit Note for ${invoice.invoiceNumber}`, quantity: 1, unitPrice: -creditAmount }],
      notes: reason || `Credit note reversal for invoice ${invoice.invoiceNumber}`,
      createdBy: req.user._id
    });
    await creditNote.save();

    // Journal: DR Revenue (or AR) / CR AR — reversal
    const companyId = co(invoice);
    const A = acct(companyId);
    const arAccount = await A.resolve(FinanceHelper.ACCOUNTS.RECEIVABLE);
    const revenueAccount = await A.resolve('4001');

    if (arAccount && revenueAccount) {
      await FinanceHelper.createAndPostJournalEntry(withCompany({
        date: creditNote.invoiceDate,
        reference: creditNoteNumber,
        description: `Credit Note: ${creditNoteNumber} – ${reason || 'Customer refund'}`,
        department: invoice.department,
        module: invoice.module,
        referenceId: creditNote._id,
        referenceType: 'invoice',
        journalCode: 'INV',
        createdBy: req.user._id,
        lines: [
          { account: revenueAccount._id, description: `Revenue reversal – ${creditNoteNumber}`, debit: creditAmount, department: invoice.department },
          { account: arAccount._id, description: `AR credit – ${creditNoteNumber}`, credit: creditAmount, department: invoice.department }
        ]
      }, companyId));
    }

    res.status(201).json({
      success: true,
      message: `Credit Note ${creditNoteNumber} created for PKR ${creditAmount}`,
      data: creditNote
    });
  })
);

// ═════════════════════════════════════════════════════════════════════════════
// SALES ORDER → AR INVOICE (one-click, Odoo-style)
// ═════════════════════════════════════════════════════════════════════════════
const SalesOrder = require('../models/sales/SalesOrder');

// POST /api/finance/sales-orders/:orderId/create-invoice
router.post('/sales-orders/:orderId/create-invoice',
  authorize('super_admin', 'admin', 'finance_manager', 'sales_manager'),
  asyncHandler(async (req, res) => {
    const mongoose = require('mongoose');
    const order = await SalesOrder.findById(req.params.orderId)
      .populate('customer', 'name email phone');
    if (!order) return res.status(404).json({ success: false, message: 'Sales order not found' });
    if (order.billingStatus === 'fully_invoiced') {
      return res.status(400).json({ success: false, message: 'This sales order is already fully invoiced' });
    }

    const { dueDate, notes } = req.body;
    const invoiceNumber = `INV-${order.orderNumber}`;

    const lineItems = (order.items || []).map(item => ({
      description: `${item.productName} – SO ${order.orderNumber}`,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      taxRate: order.taxRate || 0
    }));

    const subtotal = lineItems.reduce((s, l) => s + l.quantity * l.unitPrice, 0);
    const taxAmount = Math.round(subtotal * ((order.taxRate || 0) / 100) * 100) / 100;
    const totalAmount = subtotal + taxAmount - (order.discount || 0);

    const billDueDate = dueDate ? new Date(dueDate) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    const company = await resolveCompanyForFinanceRoute(req);
    const arInvoice = await FinanceHelper.createARFromInvoice({
      companyId: company._id,
      customerName: order.customer?.name || order.customerName || 'Customer',
      customerEmail: order.customer?.email || '',
      customerId: order.customer?._id || null,
      invoiceNumber,
      invoiceDate: order.orderDate || new Date(),
      dueDate: billDueDate,
      amount: totalAmount,
      taxAmount,
      department: 'sales',
      module: 'sales',
      referenceId: order._id,
      referenceType: 'invoice',
      lineItems,
      notes: notes || `Auto-generated from Sales Order ${order.orderNumber}`,
      createdBy: req.user._id
    });

    // Mark sales order as invoiced
    order.billingStatus = 'fully_invoiced';
    order.arInvoice = arInvoice._id;
    await order.save();

    res.status(201).json({
      success: true,
      message: `Invoice ${invoiceNumber} created from Sales Order ${order.orderNumber}`,
      data: { invoice: arInvoice, order: { _id: order._id, orderNumber: order.orderNumber, billingStatus: order.billingStatus } }
    });
  })
);

// ═════════════════════════════════════════════════════════════════════════════
// YEAR-END CLOSING
// ═════════════════════════════════════════════════════════════════════════════

// POST /api/finance/year-end-closing — transfer net income to Retained Earnings
router.post('/year-end-closing',
  authorize('super_admin', 'admin', 'finance_manager'),
  asyncHandler(async (req, res) => {
    const { year, retainedEarningsAccountId } = req.body;
    if (!year) return res.status(400).json({ success: false, message: 'Year is required' });

    const { companyId, jeMatch, withCo } = await financeScope(req);
    const A = acct(companyId);
    const from = new Date(`${year}-01-01`);
    const to = new Date(`${year}-12-31T23:59:59.999Z`);

    const rows = await JournalEntry.aggregate([
      { $match: jeMatch({ status: 'posted', date: { $gte: from, $lte: to } }) },
      { $unwind: '$lines' },
      { $group: { _id: '$lines.account', totalDebit: { $sum: '$lines.debit' }, totalCredit: { $sum: '$lines.credit' } } },
      { $lookup: { from: 'accounts', localField: '_id', foreignField: '_id', as: 'acc' } },
      { $unwind: '$acc' },
      { $match: { 'acc.type': { $in: ['revenue', 'income', 'other_income', 'expense', 'cost_of_goods_sold', 'operating_expense', 'other_expense', 'depreciation'] } } },
      {
        $project: {
          accountType: '$acc.type', totalDebit: 1, totalCredit: 1,
          balance: {
            $cond: {
              if: { $in: ['$acc.type', ['expense', 'cost_of_goods_sold', 'operating_expense', 'other_expense', 'depreciation']] },
              then: { $subtract: ['$totalDebit', '$totalCredit'] },
              else: { $subtract: ['$totalCredit', '$totalDebit'] }
            }
          }
        }
      }
    ]);

    const revenueTypes = ['revenue', 'income', 'other_income'];
    const totalRevenue = rows.filter(r => revenueTypes.includes(r.accountType)).reduce((s, r) => s + (r.balance || 0), 0);
    const totalExpenses = rows.filter(r => !revenueTypes.includes(r.accountType)).reduce((s, r) => s + (r.balance || 0), 0);
    const netIncome = Math.round((totalRevenue - totalExpenses) * 100) / 100;

    if (Math.abs(netIncome) < 0.01) {
      return res.json({ success: true, message: 'Net income is zero — no closing entry needed', data: { netIncome } });
    }

    // Resolve retained earnings account
    let reAccount = retainedEarningsAccountId
      ? await A.map(retainedEarningsAccountId)
      : await A.resolve('3002');
    if (!reAccount) reAccount = await Account.findOne({ companyId, type: { $in: ['retained_earnings', 'equity', 'Equity'] } });
    if (!reAccount) return res.status(400).json({ success: false, message: 'Retained Earnings account not found. Please provide retainedEarningsAccountId.' });

    // Close income/expense accounts via a closing entry
    // Net profit: DR Revenue accounts / CR Retained Earnings (net income > 0)
    //             DR Retained Earnings / CR Expense accounts  (conceptually balanced)
    // Simplified: single line closing entry for the net
    const closingLines = netIncome > 0
      ? [
          { account: reAccount._id, description: `Net profit for ${year} transferred to Retained Earnings`, credit: netIncome, department: 'finance' },
          // Placeholder debit to Income Summary (use a clearing approach)
          // In practice this balances via the revenue/expense accounts already closed
        ]
      : [];

    if (netIncome > 0) {
      const revAccount = await Account.findOne({ companyId, type: { $in: ['revenue', 'income', 'Revenue'] } });
      if (revAccount) {
        await FinanceHelper.createAndPostJournalEntry(withCo({
          date: new Date(`${year}-12-31`),
          reference: `CLOSE-${year}`,
          description: `Year-End Closing — Net Income for ${year}`,
          department: 'finance',
          module: 'finance',
          referenceType: 'adjustment',
          journalCode: 'GEN',
          createdBy: req.user._id,
          lines: [
            { account: revAccount._id, description: `Closing revenue to retained earnings`, debit: netIncome, department: 'finance' },
            { account: reAccount._id, description: `Net income ${year} — retained earnings`, credit: netIncome, department: 'finance' }
          ]
        }));
      }
    } else {
      const expAccount = await Account.findOne({ companyId, type: { $in: ['expense', 'operating_expense', 'Expense'] } });
      if (expAccount) {
        await FinanceHelper.createAndPostJournalEntry(withCo({
          date: new Date(`${year}-12-31`),
          reference: `CLOSE-${year}`,
          description: `Year-End Closing — Net Loss for ${year}`,
          department: 'finance',
          module: 'finance',
          referenceType: 'adjustment',
          journalCode: 'GEN',
          createdBy: req.user._id,
          lines: [
            { account: reAccount._id, description: `Net loss ${year} — retained earnings`, debit: Math.abs(netIncome), department: 'finance' },
            { account: expAccount._id, description: `Closing expense to retained earnings`, credit: Math.abs(netIncome), department: 'finance' }
          ]
        }));
      }
    }

    res.json({
      success: true,
      message: `Year-End closing entry posted for ${year}. Net ${netIncome >= 0 ? 'Income' : 'Loss'}: PKR ${Math.abs(netIncome).toLocaleString()}`,
      data: { year, netIncome, totalRevenue: Math.round(totalRevenue * 100) / 100, totalExpenses: Math.round(totalExpenses * 100) / 100 }
    });
  })
);

// ═════════════════════════════════════════════════════════════════════════════
// CASH FLOW STATEMENT
// ═════════════════════════════════════════════════════════════════════════════
router.get('/reports/cash-flow',
  authorize('super_admin', 'admin', 'finance_manager'),
  asyncHandler(async (req, res) => {
    const { fromDate, toDate } = req.query;
    const from = fromDate ? new Date(fromDate) : new Date(new Date().getFullYear(), 0, 1);
    const to = toDate ? new Date(toDate) : new Date();
    const { jeMatch } = await financeScope(req);

    const operatingTypes = ['revenue', 'income', 'other_income', 'expense', 'cost_of_goods_sold', 'operating_expense', 'other_expense', 'depreciation', 'accounts_receivable', 'accounts_payable', 'current_asset', 'current_liability'];
    const investingTypes = ['fixed_asset', 'other_asset'];
    const financingTypes = ['equity', 'long_term_liability', 'retained_earnings', 'owners_equity'];

    const allRows = await JournalEntry.aggregate([
      { $match: jeMatch({ status: 'posted', date: { $gte: from, $lte: to } }) },
      { $unwind: '$lines' },
      { $group: { _id: '$lines.account', totalDebit: { $sum: '$lines.debit' }, totalCredit: { $sum: '$lines.credit' } } },
      { $lookup: { from: 'accounts', localField: '_id', foreignField: '_id', as: 'acc' } },
      { $unwind: '$acc' },
      {
        $project: {
          accountNumber: '$acc.accountNumber', accountName: '$acc.name', accountType: '$acc.type', totalDebit: 1, totalCredit: 1,
          netFlow: { $subtract: ['$totalCredit', '$totalDebit'] }
        }
      },
      { $sort: { accountNumber: 1 } }
    ]);

    const operating = allRows.filter(r => operatingTypes.some(t => r.accountType?.includes(t)));
    const investing = allRows.filter(r => investingTypes.some(t => r.accountType?.includes(t)));
    const financing = allRows.filter(r => financingTypes.some(t => r.accountType?.includes(t)));

    const totalOperating = Math.round(operating.reduce((s, r) => s + (r.netFlow || 0), 0) * 100) / 100;
    const totalInvesting = Math.round(investing.reduce((s, r) => s + (r.netFlow || 0), 0) * 100) / 100;
    const totalFinancing = Math.round(financing.reduce((s, r) => s + (r.netFlow || 0), 0) * 100) / 100;
    const netCashChange = Math.round((totalOperating + totalInvesting + totalFinancing) * 100) / 100;

    res.json({
      success: true,
      data: {
        fromDate: from, toDate: to,
        operating: { rows: operating, total: totalOperating },
        investing: { rows: investing, total: totalInvesting },
        financing: { rows: financing, total: totalFinancing },
        summary: { totalOperating, totalInvesting, totalFinancing, netCashChange }
      }
    });
  })
);

// ═════════════════════════════════════════════════════════════════════════════
// BILL FROM GRN — Three-Way Match
// ═════════════════════════════════════════════════════════════════════════════

// POST /api/finance/grn/:grnId/create-bill
// Creates a vendor AP bill from a GRN in one click (Odoo-style)
router.post('/grn/:grnId/create-bill',
  authorize('super_admin', 'admin', 'finance_manager', 'procurement_manager'),
  asyncHandler(async (req, res) => {
    const grn = await GoodsReceive.findById(req.params.grnId)
      .populate('supplier', 'name email phone')
      .populate('purchaseOrder', 'poNumber');

    if (!grn) return res.status(404).json({ success: false, message: 'GRN not found' });
    if (grn.billingStatus === 'fully_billed') {
      return res.status(400).json({ success: false, message: 'This GRN is already fully billed' });
    }

    const { vendorInvoiceNumber, dueDate, notes } = req.body;

    // Build line items from GRN items
    const lineItems = grn.items.map(item => ({
      description: `${item.itemName} (${item.itemCode}) — GRN ${grn.receiveNumber}`,
      quantity: item.quantity,
      unitPrice: item.unitPrice || 0,
      taxRate: 0
    }));

    const subtotal = lineItems.reduce((s, l) => s + (l.quantity * l.unitPrice), 0);
    const billNumber = `BILL-${grn.receiveNumber}`;

    // Build due date (30 days default)
    const billDueDate = dueDate
      ? new Date(dueDate)
      : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    const company = await resolveCompanyForFinanceRoute(req);
    const companyId = await resolveDocumentCompanyId({
      companyId: company._id,
      grnId: grn._id,
      purchaseOrderId: grn.purchaseOrder?._id || grn.purchaseOrder
    });

    // Create AP bill via FinanceHelper (posts GRNI → AP journal)
    const apBill = await FinanceHelper.createAPFromBill({
      companyId,
      vendorName: grn.supplierName || grn.supplier?.name || 'Unknown Vendor',
      vendorEmail: grn.supplier?.email || '',
      vendorId: grn.supplier?._id || null,
      billNumber,
      vendorInvoiceNumber: vendorInvoiceNumber || '',
      billDate: grn.receiveDate || new Date(),
      dueDate: billDueDate,
      amount: subtotal,
      department: 'procurement',
      module: 'procurement',
      referenceId: grn._id,
      referenceType: 'grn',
      lineItems,
      notes: notes || `Auto-generated from GRN ${grn.receiveNumber}`,
      createdBy: req.user._id
    });

    // Update GRN billing status/amount
    grn.billedAmount = Math.round((Number(grn.netAmount || grn.total || 0) || 0) * 100) / 100;
    grn.billingStatus = 'fully_billed';
    grn.vendorBill = apBill._id;
    grn.vendorBillNumber = billNumber;
    await grn.save();

    res.status(201).json({
      success: true,
      message: `Vendor bill ${billNumber} created from GRN ${grn.receiveNumber}`,
      data: { bill: apBill, grn: { _id: grn._id, receiveNumber: grn.receiveNumber, billingStatus: grn.billingStatus } }
    });
  })
);

// GET /api/finance/grn/:grnId/billing-status
router.get('/grn/:grnId/billing-status',
  authorize('super_admin', 'admin', 'finance_manager', 'procurement_manager'),
  asyncHandler(async (req, res) => {
    const grn = await GoodsReceive.findById(req.params.grnId)
      .select('receiveNumber billingStatus vendorBill vendorBillNumber financePosted')
      .populate('vendorBill', 'billNumber totalAmount status');
    if (!grn) return res.status(404).json({ success: false, message: 'GRN not found' });
    res.json({ success: true, data: grn });
  })
);

// ═════════════════════════════════════════════════════════════════════════════
// JOURNAL ENTRY REVERSAL
// ═════════════════════════════════════════════════════════════════════════════

// POST /api/finance/journal-entries/:id/reverse
router.post('/journal-entries/:id/reverse',
  authorize('super_admin', 'admin', 'finance_manager'),
  asyncHandler(async (req, res) => {
    const original = await JournalEntry.findById(req.params.id).populate('lines.account');
    if (!original) return res.status(404).json({ success: false, message: 'Journal entry not found' });
    const { companyId } = await financeScope(req);
    assertDocCompany(original, companyId, 'Journal entry');
    if (original.status !== 'posted') {
      return res.status(400).json({ success: false, message: 'Only posted entries can be reversed' });
    }
    if (original.isReversed) {
      return res.status(400).json({ success: false, message: 'This entry has already been reversed' });
    }

    const { date, reason } = req.body;
    const reversalDate = date ? new Date(date) : new Date();

    // Mirror lines: swap debit ↔ credit
    const reversalLines = original.lines.map(line => ({
      account: line.account._id || line.account,
      description: `Reversal: ${line.description || ''}`,
      debit: line.credit,
      credit: line.debit,
      department: line.department,
      costCenter: line.costCenter
    }));

    const reversalEntry = await FinanceHelper.createAndPostJournalEntry(withCompany({
      date: reversalDate,
      reference: `REV-${original.entryNumber}`,
      description: reason || `Reversal of ${original.entryNumber}`,
      department: original.department,
      module: original.module,
      referenceId: original._id,
      referenceType: original.referenceType,
      journalCode: 'GEN',
      createdBy: req.user.id,
      lines: reversalLines
    }, original.companyId || companyId));

    // Mark original as reversed
    original.isReversed = true;
    original.reversalEntry = reversalEntry._id;
    original.status = 'reversed';
    await original.save();

    res.json({
      success: true,
      message: `Entry ${original.entryNumber} reversed — reversal entry ${reversalEntry.entryNumber} created`,
      data: { original, reversal: reversalEntry }
    });
  })
);

// ═════════════════════════════════════════════════════════════════════════════
// BALANCE SHEET REPORT
// ═════════════════════════════════════════════════════════════════════════════
router.get('/reports/balance-sheet',
  authorize('super_admin', 'admin', 'finance_manager'),
  asyncHandler(async (req, res) => {
    const asOf = req.query.asOfDate ? new Date(req.query.asOfDate) : new Date();
    const { jeMatch } = await financeScope(req);

    const rows = await JournalEntry.aggregate([
      { $match: jeMatch({ status: 'posted', date: { $lte: asOf } }) },
      { $unwind: '$lines' },
      { $group: { _id: '$lines.account', totalDebit: { $sum: '$lines.debit' }, totalCredit: { $sum: '$lines.credit' } } },
      { $lookup: { from: 'accounts', localField: '_id', foreignField: '_id', as: 'acc' } },
      { $unwind: '$acc' },
      {
        $project: {
          accountNumber: '$acc.accountNumber',
          accountName: '$acc.name',
          accountType: '$acc.type',
          accountCategory: '$acc.category',
          accountDetailType: '$acc.detailType',
          totalDebit: 1,
          totalCredit: 1,
          // Account model has no normalBalance; use type (matches Account enum).
          // Asset & Expense: debit − credit. Liability, Equity, Revenue: credit − debit.
          balance: {
            $cond: {
              if: { $in: ['$acc.type', ['Asset', 'Expense']] },
              then: { $subtract: ['$totalDebit', '$totalCredit'] },
              else: { $subtract: ['$totalCredit', '$totalDebit'] }
            }
          }
        }
      },
      { $sort: { accountNumber: 1 } }
    ]);

    // BS sections: exact Account.type match
    const assets = rows.filter(r => r.accountType === 'Asset');
    const liabilities = rows.filter(r => r.accountType === 'Liability');
    const equity = rows.filter(r => r.accountType === 'Equity');
    const revenueRows = rows.filter(r => r.accountType === 'Revenue');
    const expenseRows = rows.filter(r => r.accountType === 'Expense');

    const totalAssets = assets.reduce((s, r) => s + (r.balance || 0), 0);
    const totalLiabilities = liabilities.reduce((s, r) => s + (r.balance || 0), 0);
    const rawEquityTotal = equity.reduce((s, r) => s + (r.balance || 0), 0);
    const totalRevenue = revenueRows.reduce((s, r) => s + (r.balance || 0), 0);
    const totalExpense = expenseRows.reduce((s, r) => s + (r.balance || 0), 0);

    // Unclosed P&L affects the accounting equation: Assets = Liabilities + Equity + (Revenue − Expense)
    const netIncomeFromPL = Math.round((totalRevenue - totalExpense) * 100) / 100;

    // In standard QuickBooks Balance Sheet, Net Income for the period is reported directly under Equity
    const equityWithPL = [...equity];
    if (Math.abs(netIncomeFromPL) > 0.001 || equity.length === 0) {
      equityWithPL.push({
        _id: 'unclosed-net-income',
        accountNumber: '—',
        accountName: 'Net Income / (Loss)',
        accountType: 'Equity',
        accountCategory: 'Equity',
        accountDetailType: 'Net Income',
        balance: netIncomeFromPL,
        isNetIncomeRow: true
      });
    }

    const totalEquityWithPL = Math.round((rawEquityTotal + netIncomeFromPL) * 100) / 100;
    const totalAssetsR = Math.round(totalAssets * 100) / 100;
    const totalLiabR = Math.round(totalLiabilities * 100) / 100;
    const liabPlusEquityPL = Math.round((totalLiabilities + totalEquityWithPL) * 100) / 100;

    res.json({
      success: true,
      data: {
        asOfDate: asOf,
        assets: { rows: assets, total: totalAssetsR },
        liabilities: { rows: liabilities, total: totalLiabR },
        equity: { rows: equityWithPL, total: totalEquityWithPL },
        pAndL: {
          revenueRows,
          expenseRows,
          totalRevenue: Math.round(totalRevenue * 100) / 100,
          totalExpense: Math.round(totalExpense * 100) / 100,
          netIncome: netIncomeFromPL
        },
        totals: {
          totalAssets: totalAssetsR,
          totalLiabilities: totalLiabR,
          totalEquity: totalEquityWithPL,
          liabilitiesAndEquity: liabPlusEquityPL,
          liabilitiesEquityAndPL: liabPlusEquityPL,
          isBalanced: Math.abs(totalAssetsR - liabPlusEquityPL) < 1
        }
      }
    });
  })
);

// ═════════════════════════════════════════════════════════════════════════════
// PROFIT & LOSS REPORT
// ═════════════════════════════════════════════════════════════════════════════
router.get('/reports/profit-loss',
  authorize('super_admin', 'admin', 'finance_manager'),
  asyncHandler(async (req, res) => {
    const { fromDate, toDate } = req.query;
    // Inclusive calendar-day range in UTC. `new Date('2026-03-31')` is midnight = start of day, so same-day
    // journals after 00:00 UTC were wrongly excluded; use end-of-day for `to`.
    const from = fromDate
      ? new Date(`${fromDate}T00:00:00.000Z`)
      : new Date(Date.UTC(new Date().getUTCFullYear(), 0, 1, 0, 0, 0, 0));
    const to = toDate ? new Date(`${toDate}T23:59:59.999Z`) : new Date();
    const { jeMatch } = await financeScope(req);

    const rows = await JournalEntry.aggregate([
      { $match: jeMatch({ status: 'posted', date: { $gte: from, $lte: to } }) },
      { $unwind: '$lines' },
      { $group: { _id: '$lines.account', totalDebit: { $sum: '$lines.debit' }, totalCredit: { $sum: '$lines.credit' } } },
      { $lookup: { from: 'accounts', localField: '_id', foreignField: '_id', as: 'acc' } },
      { $unwind: '$acc' },
      {
        $match: {
          // Account model enum: Asset, Liability, Equity, Revenue, Expense (capitalized — lowercase never matched)
          'acc.type': { $in: ['Revenue', 'Expense'] }
        }
      },
      {
        $project: {
          accountNumber: '$acc.accountNumber',
          accountName: '$acc.name',
          accountType: '$acc.type',
          accountCategory: '$acc.category',
          accountDetailType: '$acc.detailType',
          totalDebit: 1,
          totalCredit: 1,
          balance: {
            $cond: {
              if: { $eq: ['$acc.type', 'Expense'] },
              then: { $subtract: ['$totalDebit', '$totalCredit'] },
              else: { $subtract: ['$totalCredit', '$totalDebit'] }
            }
          }
        }
      },
      { $sort: { accountNumber: 1 } }
    ]);

    const revenue = rows.filter(r => r.accountType === 'Revenue');
    const expenses = rows.filter(r => r.accountType === 'Expense');

    const totalRevenue = revenue.reduce((s, r) => s + (r.balance || 0), 0);
    const totalExpenses = expenses.reduce((s, r) => s + (r.balance || 0), 0);
    const netProfit = totalRevenue - totalExpenses;

    res.json({
      success: true,
      data: {
        fromDate: from,
        toDate: to,
        revenue: { rows: revenue, total: Math.round(totalRevenue * 100) / 100 },
        expenses: { rows: expenses, total: Math.round(totalExpenses * 100) / 100 },
        totals: {
          totalRevenue: Math.round(totalRevenue * 100) / 100,
          totalExpenses: Math.round(totalExpenses * 100) / 100,
          netProfit: Math.round(netProfit * 100) / 100,
          isProfitable: netProfit >= 0
        }
      }
    });
  })
);

// ═════════════════════════════════════════════════════════════════════════════
// TAX SUMMARY / FBR REPORT
// ═════════════════════════════════════════════════════════════════════════════
router.get('/reports/tax-summary',
  authorize('super_admin', 'admin', 'finance_manager'),
  asyncHandler(async (req, res) => {
    const { fromDate, toDate } = req.query;
    const from = fromDate ? new Date(fromDate) : new Date(new Date().getFullYear(), 0, 1);
    const to = toDate ? new Date(toDate) : new Date();
    const { q } = await financeScope(req);

    const inputTaxBills = await AccountsPayable.find(q({
      createdAt: { $gte: from, $lte: to },
      taxAmount: { $gt: 0 }
    })).select('billNumber vendor totalAmount taxAmount subtotal createdAt');

    const outputTaxInvoices = await AccountsReceivable.find(q({
      createdAt: { $gte: from, $lte: to },
      taxAmount: { $gt: 0 }
    })).select('invoiceNumber customerName amount taxAmount createdAt');

    const totalInputTax = inputTaxBills.reduce((s, b) => s + (b.taxAmount || 0), 0);
    const totalOutputTax = outputTaxInvoices.reduce((s, i) => s + (i.taxAmount || 0), 0);
    const netTaxPayable = totalOutputTax - totalInputTax;

    res.json({
      success: true,
      data: {
        fromDate: from,
        toDate: to,
        inputTax: {
          rows: inputTaxBills,
          total: Math.round(totalInputTax * 100) / 100
        },
        outputTax: {
          rows: outputTaxInvoices,
          total: Math.round(totalOutputTax * 100) / 100
        },
        summary: {
          totalInputTax: Math.round(totalInputTax * 100) / 100,
          totalOutputTax: Math.round(totalOutputTax * 100) / 100,
          netTaxPayable: Math.round(netTaxPayable * 100) / 100,
          isRefundable: netTaxPayable < 0
        }
      }
    });
  })
);

// ═════════════════════════════════════════════════════════════════════════════
// OPENING BALANCES
// ═════════════════════════════════════════════════════════════════════════════

// POST /api/finance/opening-balances — post opening balances as a special journal entry
router.post('/opening-balances',
  authorize('super_admin', 'admin', 'finance_manager'),
  asyncHandler(async (req, res) => {
    const { date, lines, notes } = req.body;
    const { withCo } = await financeScope(req);

    if (!lines || lines.length === 0) {
      return res.status(400).json({ success: false, message: 'At least one balance line is required' });
    }

    // Validate balance: debits must equal credits
    const totalDebits = lines.reduce((s, l) => s + (Number(l.debit) || 0), 0);
    const totalCredits = lines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
    if (Math.abs(totalDebits - totalCredits) > 0.01) {
      return res.status(400).json({
        success: false,
        message: `Opening balances must balance. Debits: ${totalDebits.toFixed(2)}, Credits: ${totalCredits.toFixed(2)}, Difference: ${Math.abs(totalDebits - totalCredits).toFixed(2)}`
      });
    }

    const entry = await FinanceHelper.createAndPostJournalEntry(withCo({
      date: date ? new Date(date) : new Date(),
      reference: 'OPEN-BAL',
      description: notes || 'Opening balances — system setup',
      department: 'finance',
      module: 'finance',
      referenceType: 'adjustment',
      journalCode: 'GEN',
      createdBy: req.user.id,
      lines: lines.map(l => ({
        account: l.account,
        description: l.description || 'Opening balance',
        debit: Number(l.debit) || 0,
        credit: Number(l.credit) || 0,
        department: 'finance'
      }))
    }));

    res.status(201).json({
      success: true,
      message: 'Opening balances posted successfully',
      data: entry
    });
  })
);

// GET /api/finance/opening-balances — get all opening balance entries
router.get('/opening-balances',
  authorize('super_admin', 'admin', 'finance_manager'),
  asyncHandler(async (req, res) => {
    const { q } = await financeScope(req);
    const entries = await JournalEntry.find(q({ reference: 'OPEN-BAL' }))
      .populate('lines.account', 'name accountNumber type')
      .populate('createdBy', 'name')
      .sort({ date: -1 });
    res.json({ success: true, data: entries });
  })
);

// ═════════════════════════════════════════════════════════════════════════════
// CUSTOMER PAYMENTS — all AR receipts consolidated
// ═════════════════════════════════════════════════════════════════════════════
router.get('/customer-payments',
  authorize('super_admin', 'admin', 'finance_manager'),
  asyncHandler(async (req, res) => {
    const { fromDate, toDate, search } = req.query;
    const { q } = await financeScope(req);

    const match = q({ 'payments.0': { $exists: true } });
    const records = await AccountsReceivable.find(match)
      .select('invoiceNumber customer payments paidAmount totalAmount department')
      .sort({ 'payments.paymentDate': -1 })
      .lean();

    // Flatten payments array across all invoices
    const payments = [];
    for (const inv of records) {
      for (const p of (inv.payments || [])) {
        const payDate = p.paymentDate ? new Date(p.paymentDate) : null;
        if (fromDate && payDate && payDate < new Date(fromDate)) continue;
        if (toDate && payDate && payDate > new Date(toDate)) continue;
        if (search) {
          const q = search.toLowerCase();
          const matches = inv.customer?.name?.toLowerCase().includes(q)
            || inv.invoiceNumber?.toLowerCase().includes(q)
            || p.reference?.toLowerCase().includes(q);
          if (!matches) continue;
        }
        payments.push({
          _id: p._id,
          invoiceNumber: inv.invoiceNumber,
          customerName: inv.customer?.name || '—',
          customerEmail: inv.customer?.email || '',
          paymentDate: p.paymentDate,
          amount: p.amount,
          paymentMethod: p.paymentMethod,
          reference: p.reference,
          department: inv.department,
          invoiceId: inv._id
        });
      }
    }

    // Sort by date desc
    payments.sort((a, b) => new Date(b.paymentDate) - new Date(a.paymentDate));

    const totalAmount = payments.reduce((s, p) => s + (p.amount || 0), 0);
    res.json({ success: true, data: { payments, totalAmount: Math.round(totalAmount * 100) / 100, count: payments.length } });
  })
);

// ═════════════════════════════════════════════════════════════════════════════
// CREDIT NOTES — all AR credit notes (negative-amount AR entries)
// ═════════════════════════════════════════════════════════════════════════════
router.get('/credit-notes',
  authorize('super_admin', 'admin', 'finance_manager'),
  asyncHandler(async (req, res) => {
    const { fromDate, toDate, search } = req.query;
    const { q } = await financeScope(req);
    const match = q({ totalAmount: { $lt: 0 } });
    if (fromDate || toDate) {
      match.invoiceDate = {};
      if (fromDate) match.invoiceDate.$gte = new Date(fromDate);
      if (toDate) match.invoiceDate.$lte = new Date(toDate);
    }
    if (search) {
      match.$or = [
        { invoiceNumber: { $regex: search, $options: 'i' } },
        { 'customer.name': { $regex: search, $options: 'i' } }
      ];
    }

    const notes = await AccountsReceivable.find(match)
      .select('invoiceNumber customer invoiceDate totalAmount paidAmount status notes department referenceId')
      .sort({ invoiceDate: -1 })
      .lean();

    const total = notes.reduce((s, n) => s + Math.abs(n.totalAmount || 0), 0);
    res.json({ success: true, data: { notes, total: Math.round(total * 100) / 100, count: notes.length } });
  })
);

// ═════════════════════════════════════════════════════════════════════════════
// VENDOR PAYMENTS — all AP payments consolidated
// ═════════════════════════════════════════════════════════════════════════════
router.get('/vendor-payments',
  authorize('super_admin', 'admin', 'finance_manager'),
  asyncHandler(async (req, res) => {
    const { fromDate, toDate, search } = req.query;
    const { q } = await financeScope(req);

    const match = q({ 'payments.0': { $exists: true } });
    const records = await AccountsPayable.find(match)
      .select('billNumber vendor payments amountPaid totalAmount department')
      .sort({ 'payments.paymentDate': -1 })
      .lean();

    const payments = [];
    for (const bill of records) {
      for (const p of (bill.payments || [])) {
        const payDate = p.paymentDate ? new Date(p.paymentDate) : null;
        if (fromDate && payDate && payDate < new Date(fromDate)) continue;
        if (toDate && payDate && payDate > new Date(toDate)) continue;
        if (search) {
          const q = search.toLowerCase();
          const matches = bill.vendor?.name?.toLowerCase().includes(q)
            || bill.billNumber?.toLowerCase().includes(q)
            || p.reference?.toLowerCase().includes(q);
          if (!matches) continue;
        }
        payments.push({
          _id: p._id,
          billNumber: bill.billNumber,
          vendorName: bill.vendor?.name || bill.vendor || '—',
          vendorEmail: bill.vendor?.email || '',
          paymentDate: p.paymentDate,
          amount: p.amount,
          paymentMethod: p.paymentMethod,
          reference: p.reference,
          department: bill.department,
          billId: bill._id
        });
      }
    }

    payments.sort((a, b) => new Date(b.paymentDate) - new Date(a.paymentDate));
    const totalAmount = payments.reduce((s, p) => s + (p.amount || 0), 0);
    res.json({ success: true, data: { payments, totalAmount: Math.round(totalAmount * 100) / 100, count: payments.length } });
  })
);

// ═════════════════════════════════════════════════════════════════════════════
// VENDOR REFUNDS — purchase returns with finance impact
// ═════════════════════════════════════════════════════════════════════════════
router.get('/vendor-refunds',
  authorize('super_admin', 'admin', 'finance_manager'),
  asyncHandler(async (req, res) => {
    const PurchaseReturn = require('../models/procurement/PurchaseReturn');
    const { fromDate, toDate, search, status } = req.query;

    const match = {};
    if (status) match.status = status;
    if (fromDate || toDate) {
      match.returnDate = {};
      if (fromDate) match.returnDate.$gte = new Date(fromDate);
      if (toDate) match.returnDate.$lte = new Date(toDate);
    }
    if (search) {
      match.$or = [
        { returnNumber: { $regex: search, $options: 'i' } },
        { supplierName: { $regex: search, $options: 'i' } }
      ];
    }

    const returns = await PurchaseReturn.find(match)
      .populate('supplier', 'name email')
      .populate('goodsReceive', 'grnNumber receiveDate')
      .populate('purchaseOrder', 'orderNumber')
      .populate('journalEntry', 'entryNumber status')
      .sort({ returnDate: -1 })
      .lean();

    const total = returns.reduce((s, r) => s + (r.totalAmount || 0), 0);
    res.json({ success: true, data: { returns, total: Math.round(total * 100) / 100, count: returns.length } });
  })
);

// ═════════════════════════════════════════════════════════════════════════════
// BILL TO RECEIVE — GRNs received but not yet billed (accrual gap)
// ═════════════════════════════════════════════════════════════════════════════
router.get('/bill-to-receive',
  authorize('super_admin', 'admin', 'finance_manager'),
  asyncHandler(async (req, res) => {
    const GoodsReceive = require('../models/procurement/GoodsReceive');
    const { fromDate, toDate, search } = req.query;

    const match = { billingStatus: 'waiting_bills', status: { $in: ['Received', 'Complete', 'Partial'] } };
    if (fromDate || toDate) {
      match.receiveDate = {};
      if (fromDate) match.receiveDate.$gte = new Date(fromDate);
      if (toDate) match.receiveDate.$lte = new Date(toDate);
    }
    if (search) {
      match.$or = [
        { grnNumber: { $regex: search, $options: 'i' } }
      ];
    }

    const grns = await GoodsReceive.find(match)
      .populate('purchaseOrder', 'orderNumber totalAmount vendor')
      .populate('receivedBy', 'firstName lastName')
      .select('grnNumber receiveDate purchaseOrder receivedBy totalValue billingStatus status items notes')
      .sort({ receiveDate: -1 })
      .lean();

    // Compute accrual value: sum of received items (qty * unitPrice)
    const enriched = grns.map(grn => {
      const accrualValue = (grn.items || []).reduce((s, i) => {
        return s + ((i.receivedQuantity || i.quantity || 0) * (i.unitPrice || i.rate || 0));
      }, 0);
      return { ...grn, accrualValue: Math.round(accrualValue * 100) / 100 };
    });

    const totalAccrual = enriched.reduce((s, g) => s + g.accrualValue, 0);
    res.json({ success: true, data: { grns: enriched, totalAccrual: Math.round(totalAccrual * 100) / 100, count: enriched.length } });
  })
);

// ═════════════════════════════════════════════════════════════════════════════
// BILLED NOT RECEIVED — AP bills where GRN not yet received (reverse accrual)
// ═════════════════════════════════════════════════════════════════════════════
router.get('/billed-not-received',
  authorize('super_admin', 'admin', 'finance_manager'),
  asyncHandler(async (req, res) => {
    const GoodsReceive = require('../models/procurement/GoodsReceive');
    const { fromDate, toDate, search } = req.query;

    // AP bills that were created from a PO but no GRN links back to them
    const match = { status: { $in: ['draft', 'pending', 'approved'] } };
    if (fromDate || toDate) {
      match.billDate = {};
      if (fromDate) match.billDate.$gte = new Date(fromDate);
      if (toDate) match.billDate.$lte = new Date(toDate);
    }
    if (search) {
      match.$or = [
        { billNumber: { $regex: search, $options: 'i' } },
        { 'vendor.name': { $regex: search, $options: 'i' } }
      ];
    }

    const bills = await AccountsPayable.find(match)
      .select('billNumber billDate dueDate vendor totalAmount amountPaid status purchaseOrder department')
      .sort({ billDate: -1 })
      .lean();

    // Filter: bills linked to a PO that has no fully-received GRN
    const enriched = [];
    for (const bill of bills) {
      if (!bill.purchaseOrder) {
        // Manual bill with no PO — include as billed-not-received
        enriched.push({ ...bill, grnStatus: 'no_po', grnCount: 0 });
        continue;
      }
      const grnCount = await GoodsReceive.countDocuments({
        purchaseOrder: bill.purchaseOrder,
        status: { $in: ['Received', 'Complete'] }
      });
      if (grnCount === 0) {
        enriched.push({ ...bill, grnStatus: 'not_received', grnCount: 0 });
      }
    }

    const total = enriched.reduce((s, b) => s + ((b.totalAmount || 0) - (b.amountPaid || 0)), 0);
    res.json({ success: true, data: { bills: enriched, total: Math.round(total * 100) / 100, count: enriched.length } });
  })
);

// ═════════════════════════════════════════════════════════════════════════════
// RECURRING JOURNAL ENTRIES
// ═════════════════════════════════════════════════════════════════════════════

// GET all recurring journals
router.get('/recurring-journals',
  authorize('super_admin', 'admin', 'finance_manager'),
  asyncHandler(async (req, res) => {
    const { q } = await financeScope(req);
    const journals = await RecurringJournal.find(q())
      .populate('lines.account', 'accountNumber name type')
      .populate('createdBy', 'firstName lastName')
      .sort({ nextRunDate: 1 })
      .lean();
    res.json({ success: true, data: journals });
  })
);

// GET single recurring journal
router.get('/recurring-journals/:id',
  authorize('super_admin', 'admin', 'finance_manager'),
  asyncHandler(async (req, res) => {
    const { companyId, q } = await financeScope(req);
    const j = await RecurringJournal.findOne(q({ _id: req.params.id }))
      .populate('lines.account', 'accountNumber name type')
      .lean();
    if (!j) return res.status(404).json({ success: false, message: 'Not found' });
    res.json({ success: true, data: j });
  })
);

// POST create recurring journal
router.post('/recurring-journals',
  authorize('super_admin', 'admin', 'finance_manager'),
  asyncHandler(async (req, res) => {
    const { companyId } = await financeScope(req);
    const { name, description, frequency, dayOfMonth, startDate, endDate, journalCode, department, lines, isActive } = req.body;

    if (!lines || lines.length < 2) {
      return res.status(400).json({ success: false, message: 'At least 2 journal lines required' });
    }
    const totalDebit = lines.reduce((s, l) => s + (Number(l.debit) || 0), 0);
    const totalCredit = lines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
    if (Math.abs(totalDebit - totalCredit) > 0.01) {
      return res.status(400).json({ success: false, message: `Lines not balanced: DR ${totalDebit} ≠ CR ${totalCredit}` });
    }

    const rj = new RecurringJournal({
      name, description, frequency, dayOfMonth, startDate, endDate,
      journalCode: journalCode || 'GEN', department: department || 'finance',
      lines, isActive: isActive !== false, createdBy: req.user.id, companyId
    });
    // Set initial nextRunDate = startDate
    rj.nextRunDate = new Date(startDate);
    await rj.save();
    res.status(201).json({ success: true, data: rj, message: 'Recurring journal created' });
  })
);

// PUT update recurring journal
router.put('/recurring-journals/:id',
  authorize('super_admin', 'admin', 'finance_manager'),
  asyncHandler(async (req, res) => {
    const { companyId, q } = await financeScope(req);
    const rj = await RecurringJournal.findOne(q({ _id: req.params.id }));
    if (!rj) return res.status(404).json({ success: false, message: 'Not found' });
    assertDocCompany(rj, companyId, 'Recurring journal');
    const allowed = ['name', 'description', 'frequency', 'dayOfMonth', 'startDate', 'endDate', 'journalCode', 'department', 'lines', 'isActive'];
    allowed.forEach(f => { if (req.body[f] !== undefined) rj[f] = req.body[f]; });
    rj.updatedBy = req.user.id;
    await rj.save();
    res.json({ success: true, data: rj, message: 'Updated' });
  })
);

// DELETE recurring journal
router.delete('/recurring-journals/:id',
  authorize('super_admin', 'admin', 'finance_manager'),
  asyncHandler(async (req, res) => {
    const { q } = await financeScope(req);
    await RecurringJournal.findOneAndDelete(q({ _id: req.params.id }));
    res.json({ success: true, message: 'Deleted' });
  })
);

// POST manually trigger / run a recurring journal now
router.post('/recurring-journals/:id/run',
  authorize('super_admin', 'admin', 'finance_manager'),
  asyncHandler(async (req, res) => {
    const { companyId, q, withCo } = await financeScope(req);
    const rj = await RecurringJournal.findOne(q({ _id: req.params.id })).populate('lines.account', 'accountNumber name type');
    if (!rj) return res.status(404).json({ success: false, message: 'Not found' });
    assertDocCompany(rj, companyId, 'Recurring journal');

    const entry = await FinanceHelper.createAndPostJournalEntry(withCo({
      date: new Date(),
      reference: `REC-${rj.name.substring(0, 20).replace(/\s/g, '-')}-${Date.now()}`,
      description: `[Recurring] ${rj.name}`,
      department: rj.department || 'finance',
      module: 'manual',
      referenceType: 'manual',
      journalCode: rj.journalCode || 'GEN',
      createdBy: req.user.id,
      lines: rj.lines.map(l => ({
        account: l.account._id || l.account,
        description: l.description || rj.name,
        debit: l.debit || 0,
        credit: l.credit || 0,
        department: l.department || rj.department
      }))
    }));

    rj.lastRunDate = new Date();
    rj.runCount += 1;
    rj.nextRunDate = rj.computeNextRunDate(new Date());
    rj.postedEntries.push(entry._id);
    await rj.save();

    res.json({ success: true, message: `Journal posted: ${entry.entryNumber}`, data: { entryId: entry._id, entryNumber: entry.entryNumber } });
  })
);

// ═════════════════════════════════════════════════════════════════════════════
// EMAIL INVOICE — send AR invoice to customer by email
// ═════════════════════════════════════════════════════════════════════════════
router.post('/accounts-receivable/:id/send-email',
  authorize('super_admin', 'admin', 'finance_manager'),
  asyncHandler(async (req, res) => {
    const invoice = await AccountsReceivable.findById(req.params.id).lean();
    if (!invoice) return res.status(404).json({ success: false, message: 'Invoice not found' });

    const toEmail = invoice.customer?.email;
    if (!toEmail) return res.status(400).json({ success: false, message: 'Customer has no email address on file' });

    const EmailService = require('../services/emailService');
    const emailSvc = new EmailService();

    const fmt = (n) => `PKR ${Number(n || 0).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-PK', { year: 'numeric', month: 'long', day: 'numeric' }) : '—';
    const balance = (invoice.totalAmount || 0) - (invoice.amountPaid || invoice.paidAmount || 0);
    const statusColor = { paid: '#2e7d32', partial: '#e65100', overdue: '#c62828', pending: '#1565c0', draft: '#555' };

    const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:24px 0">
<tr><td align="center">
<table width="620" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.1)">
  <!-- Header -->
  <tr><td style="background:#1976d2;padding:28px 32px">
    <table width="100%"><tr>
      <td><span style="color:#fff;font-size:22px;font-weight:900">SGC International</span><br><span style="color:#bbdefb;font-size:13px">Tax Invoice</span></td>
      <td align="right"><span style="color:#fff;font-size:26px;font-weight:700">${invoice.invoiceNumber}</span><br>
        <span style="background:${statusColor[invoice.status] || '#555'};color:#fff;font-size:11px;padding:2px 8px;border-radius:10px;font-weight:700">${(invoice.status || '').toUpperCase()}</span>
      </td>
    </tr></table>
  </td></tr>
  <!-- Bill To -->
  <tr><td style="padding:28px 32px 0">
    <table width="100%"><tr>
      <td width="50%" valign="top">
        <div style="font-size:11px;color:#888;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">Bill To</div>
        <div style="font-size:16px;font-weight:700;color:#222">${invoice.customer?.name || '—'}</div>
        ${invoice.customer?.email ? `<div style="color:#555;font-size:13px">${invoice.customer.email}</div>` : ''}
        ${invoice.customer?.phone ? `<div style="color:#555;font-size:13px">${invoice.customer.phone}</div>` : ''}
        ${invoice.customer?.address ? `<div style="color:#555;font-size:13px">${invoice.customer.address}</div>` : ''}
      </td>
      <td width="50%" valign="top" align="right">
        <table cellpadding="3" cellspacing="0">
          <tr><td style="color:#888;font-size:13px">Invoice Date:</td><td style="font-weight:600;font-size:13px;padding-left:8px">${fmtDate(invoice.invoiceDate)}</td></tr>
          <tr><td style="color:#888;font-size:13px">Due Date:</td><td style="font-weight:600;font-size:13px;padding-left:8px;color:${balance > 0 ? '#c62828' : '#2e7d32'}">${fmtDate(invoice.dueDate)}</td></tr>
          ${invoice.department ? `<tr><td style="color:#888;font-size:13px">Department:</td><td style="font-weight:600;font-size:13px;padding-left:8px">${invoice.department}</td></tr>` : ''}
        </table>
      </td>
    </tr></table>
  </td></tr>
  <!-- Amount summary -->
  <tr><td style="padding:24px 32px">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8f9fa;border-radius:6px;overflow:hidden">
      <tr style="background:#e3f2fd">
        <td style="padding:10px 16px;font-size:13px;color:#888">Invoice Total</td>
        <td style="padding:10px 16px;font-size:16px;font-weight:800;color:#1565c0;text-align:right">${fmt(invoice.totalAmount)}</td>
      </tr>
      <tr>
        <td style="padding:8px 16px;font-size:13px;color:#888">Amount Paid</td>
        <td style="padding:8px 16px;font-size:13px;text-align:right;color:#2e7d32">${fmt(invoice.amountPaid || invoice.paidAmount || 0)}</td>
      </tr>
      <tr style="background:${balance > 0 ? '#ffebee' : '#e8f5e9'}">
        <td style="padding:10px 16px;font-size:14px;font-weight:700;color:${balance > 0 ? '#c62828' : '#2e7d32'}">Balance Due</td>
        <td style="padding:10px 16px;font-size:18px;font-weight:900;color:${balance > 0 ? '#c62828' : '#2e7d32'};text-align:right">${fmt(balance)}</td>
      </tr>
    </table>
  </td></tr>
  ${invoice.notes ? `<tr><td style="padding:0 32px 16px"><div style="background:#fffde7;border-left:4px solid #fbc02d;padding:12px 16px;border-radius:4px;font-size:13px;color:#555"><strong>Notes:</strong> ${invoice.notes}</div></td></tr>` : ''}
  <!-- Footer -->
  <tr><td style="padding:20px 32px;background:#f5f5f5;border-top:1px solid #e0e0e0;text-align:center">
    <div style="font-size:12px;color:#999">SGC International &bull; tax@sgc.international &bull; www.sgc.international</div>
    <div style="font-size:11px;color:#bbb;margin-top:4px">Please retain this invoice for your records.</div>
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

    await emailSvc.transporter.sendMail({
      from: `"SGC International Finance" <${emailSvc.getFromAddress()}>`,
      to: toEmail,
      subject: `Invoice ${invoice.invoiceNumber} — SGC International`,
      html
    });

    res.json({ success: true, message: `Invoice emailed to ${toEmail}` });
  })
);

// ═════════════════════════════════════════════════════════════════════════════
// BUDGET MANAGEMENT (CRUD)
// ═════════════════════════════════════════════════════════════════════════════
const Budget = require('../models/finance/Budget');

router.get('/budgets',
  authorize('super_admin', 'admin', 'finance_manager'),
  asyncHandler(async (req, res) => {
    const { fiscalYear, department, status } = req.query;
    const { q } = await financeScope(req);
    const filter = q({});
    if (fiscalYear) filter.fiscalYear = Number(fiscalYear);
    if (department) filter.department = department;
    if (status) filter.status = status;
    const budgets = await Budget.find(filter)
      .populate('lines.account', 'name accountNumber type')
      .populate('createdBy', 'name')
      .sort({ fiscalYear: -1, name: 1 });
    res.json({ success: true, data: budgets });
  })
);

router.get('/budgets/:id',
  authorize('super_admin', 'admin', 'finance_manager'),
  asyncHandler(async (req, res) => {
    const { q } = await financeScope(req);
    const budget = await Budget.findOne(q({ _id: req.params.id }))
      .populate('lines.account', 'name accountNumber type')
      .populate('createdBy', 'name').populate('approvedBy', 'name');
    if (!budget) return res.status(404).json({ success: false, message: 'Budget not found' });
    res.json({ success: true, data: budget });
  })
);

router.post('/budgets',
  authorize('super_admin', 'admin', 'finance_manager'),
  asyncHandler(async (req, res) => {
    const { companyId } = await financeScope(req);
    const budget = await Budget.create({ ...req.body, createdBy: req.user.id, companyId });
    res.status(201).json({ success: true, data: budget, message: 'Budget created' });
  })
);

router.put('/budgets/:id',
  authorize('super_admin', 'admin', 'finance_manager'),
  asyncHandler(async (req, res) => {
    const { companyId, q } = await financeScope(req);
    const budget = await Budget.findOne(q({ _id: req.params.id }));
    if (!budget) return res.status(404).json({ success: false, message: 'Budget not found' });
    assertDocCompany(budget, companyId, 'Budget');
    if (budget.status === 'locked') return res.status(400).json({ success: false, message: 'Budget is locked' });
    const allowed = ['name', 'fiscalYear', 'startDate', 'endDate', 'department', 'description', 'status', 'lines'];
    allowed.forEach(f => { if (req.body[f] !== undefined) budget[f] = req.body[f]; });
    if (req.body.status === 'approved') { budget.approvedBy = req.user.id; budget.approvedAt = new Date(); }
    budget.updatedBy = req.user.id;
    await budget.save();
    res.json({ success: true, data: budget, message: 'Budget updated' });
  })
);

router.delete('/budgets/:id',
  authorize('super_admin', 'admin'),
  asyncHandler(async (req, res) => {
    const { companyId, q } = await financeScope(req);
    const budget = await Budget.findOne(q({ _id: req.params.id }));
    if (!budget) return res.status(404).json({ success: false, message: 'Budget not found' });
    assertDocCompany(budget, companyId, 'Budget');
    if (budget.status === 'locked') return res.status(400).json({ success: false, message: 'Cannot delete locked budget' });
    await budget.deleteOne();
    res.json({ success: true, message: 'Budget deleted' });
  })
);

// Budget vs Actual (account-level, using Budget model)
router.get('/reports/budget-vs-actual-detailed',
  authorize('super_admin', 'admin', 'finance_manager'),
  asyncHandler(async (req, res) => {
    const { budgetId } = req.query;
    if (!budgetId) return res.status(400).json({ success: false, message: 'budgetId is required' });

    const { companyId, q, jeMatch } = await financeScope(req);
    const budget = await Budget.findOne(q({ _id: budgetId })).populate('lines.account', 'name accountNumber type');
    if (!budget) return res.status(404).json({ success: false, message: 'Budget not found' });
    assertDocCompany(budget, companyId, 'Budget');

    const actualRows = await GeneralLedger.aggregate([
      { $match: jeMatch({ status: 'posted', date: { $gte: budget.startDate, $lte: budget.endDate }, ...(budget.department ? { department: budget.department } : {}) }) },
      { $lookup: { from: 'accounts', localField: 'account', foreignField: '_id', as: 'acc' } },
      { $unwind: '$acc' },
      { $match: { 'acc.type': { $in: ['Expense', 'Revenue'] } } },
      { $group: { _id: '$account', totalDebit: { $sum: '$debit' }, totalCredit: { $sum: '$credit' }, type: { $first: '$acc.type' } } }
    ]);

    const actualMap = {};
    actualRows.forEach(r => { actualMap[r._id.toString()] = r; });

    const lines = budget.lines.map(l => {
      const actual = actualMap[l.account?._id?.toString()] || {};
      const type = l.account?.type;
      const actualAmt = type === 'Revenue'
        ? (actual.totalCredit || 0) - (actual.totalDebit || 0)
        : (actual.totalDebit || 0) - (actual.totalCredit || 0);
      const variance = l.budgetAmount - actualAmt;
      return {
        accountId: l.account?._id,
        accountName: l.account?.name || l.accountName,
        accountNumber: l.account?.accountNumber,
        accountType: type,
        budgetAmount: l.budgetAmount,
        actualAmount: Math.round(actualAmt * 100) / 100,
        variance: Math.round(variance * 100) / 100,
        variancePct: l.budgetAmount > 0 ? Math.round((variance / l.budgetAmount) * 10000) / 100 : null,
        overBudget: actualAmt > l.budgetAmount
      };
    });

    const totalBudget = lines.reduce((s, l) => s + l.budgetAmount, 0);
    const totalActual = lines.reduce((s, l) => s + l.actualAmount, 0);

    res.json({ success: true, data: { budget, lines, totals: { totalBudget, totalActual, variance: totalBudget - totalActual } } });
  })
);

// ═════════════════════════════════════════════════════════════════════════════
// DEFERRED REVENUE / EXPENSES
// ═════════════════════════════════════════════════════════════════════════════
const DeferredEntry = require('../models/finance/DeferredEntry');

router.get('/deferred-entries',
  authorize('super_admin', 'admin', 'finance_manager'),
  asyncHandler(async (req, res) => {
    const { type, status } = req.query;
    const { q } = await financeScope(req);
    const filter = q({});
    if (type) filter.type = type;
    if (status) filter.status = status;
    const entries = await DeferredEntry.find(filter)
      .populate('deferredAccount', 'name accountNumber')
      .populate('recognitionAccount', 'name accountNumber')
      .populate('createdBy', 'name')
      .sort({ createdAt: -1 });
    res.json({ success: true, data: entries });
  })
);

router.get('/deferred-entries/:id',
  authorize('super_admin', 'admin', 'finance_manager'),
  asyncHandler(async (req, res) => {
    const { q } = await financeScope(req);
    const entry = await DeferredEntry.findOne(q({ _id: req.params.id }))
      .populate('deferredAccount', 'name accountNumber')
      .populate('recognitionAccount', 'name accountNumber')
      .populate('schedule.journalEntry', 'entryNumber date');
    if (!entry) return res.status(404).json({ success: false, message: 'Deferred entry not found' });
    res.json({ success: true, data: entry });
  })
);

router.post('/deferred-entries',
  authorize('super_admin', 'admin', 'finance_manager'),
  asyncHandler(async (req, res) => {
    const { companyId } = await financeScope(req);
    const entry = new DeferredEntry({ ...req.body, createdBy: req.user.id, companyId });
    entry.generateSchedule();
    await entry.save();
    res.status(201).json({ success: true, data: entry, message: 'Deferred entry created with recognition schedule' });
  })
);

router.delete('/deferred-entries/:id',
  authorize('super_admin', 'admin'),
  asyncHandler(async (req, res) => {
    const { companyId, q } = await financeScope(req);
    const entry = await DeferredEntry.findOne(q({ _id: req.params.id }));
    if (!entry) return res.status(404).json({ success: false, message: 'Not found' });
    assertDocCompany(entry, companyId, 'Deferred entry');
    if (entry.recognizedAmount > 0) return res.status(400).json({ success: false, message: 'Cannot delete entry with posted recognitions' });
    await entry.deleteOne();
    res.json({ success: true, message: 'Deferred entry deleted' });
  })
);

// Manually recognize a specific schedule line
router.post('/deferred-entries/:id/recognize/:lineId',
  authorize('super_admin', 'admin', 'finance_manager'),
  asyncHandler(async (req, res) => {
    const { companyId, q, withCo } = await financeScope(req);
    const entry = await DeferredEntry.findOne(q({ _id: req.params.id }));
    if (!entry) return res.status(404).json({ success: false, message: 'Not found' });
    assertDocCompany(entry, companyId, 'Deferred entry');

    const line = entry.schedule.id(req.params.lineId);
    if (!line) return res.status(404).json({ success: false, message: 'Schedule line not found' });
    if (line.status === 'posted') return res.status(400).json({ success: false, message: 'Already posted' });

    const isRevenue = entry.type === 'deferred_revenue';
    const je = await FinanceHelper.createAndPostJournalEntry(withCo({
      date: new Date(),
      reference: `DEFERRED-${entry._id}-${line.period}`,
      description: `${isRevenue ? 'Revenue' : 'Expense'} Recognition – ${entry.name} (${line.period})`,
      department: entry.department || 'finance',
      module: 'finance',
      referenceId: entry._id,
      referenceType: 'deferred',
      journalCode: isRevenue ? 'REV' : 'GEN',
      createdBy: req.user.id,
      lines: isRevenue
        ? [
          { account: entry.deferredAccount, description: `Deferred revenue – ${entry.name}`, debit: line.amount, department: entry.department },
          { account: entry.recognitionAccount, description: `Revenue recognized – ${entry.name}`, credit: line.amount, department: entry.department }
          ]
        : [
          { account: entry.recognitionAccount, description: `Expense recognized – ${entry.name}`, debit: line.amount, department: entry.department },
          { account: entry.deferredAccount, description: `Deferred expense – ${entry.name}`, credit: line.amount, department: entry.department }
          ]
    }));

    line.journalEntry = je._id;
    line.postedAt = new Date();
    line.status = 'posted';
    entry.markModified('schedule');
    await entry.save();

    res.json({ success: true, message: `Period ${line.period} recognized`, data: entry });
  })
);

// Run recognition for current month (manual trigger)
router.post('/deferred-entries/run-recognition',
  authorize('super_admin', 'admin', 'finance_manager'),
  asyncHandler(async (req, res) => {
    const { runDeferredEntryRecognition } = require('../utils/deferredEntryCron');
    const results = await runDeferredEntryRecognition();
    res.json({ success: true, message: `Recognition run – ${results.posted} posted`, data: results });
  })
);

// ═════════════════════════════════════════════════════════════════════════════
// BANK STATEMENT IMPORT (CSV / Excel)
// ═════════════════════════════════════════════════════════════════════════════
router.post('/banking/import-statement',
  authorize('super_admin', 'admin', 'finance_manager'),
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });

    const XLSX = require('xlsx');
    const Banking = require('../models/finance/Banking');
    const { bankAccountId, dateColumn = 'Date', descColumn = 'Description',
            debitColumn = 'Debit', creditColumn = 'Credit', balanceColumn = 'Balance' } = req.body;

    if (!bankAccountId) return res.status(400).json({ success: false, message: 'bankAccountId is required' });

    const account = await Banking.findById(bankAccountId);
    if (!account) return res.status(404).json({ success: false, message: 'Bank account not found' });

    // Parse file
    const workbook = XLSX.readFile(req.file.path);
    const sheetName = workbook.SheetNames[0];
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { raw: false, defval: '' });

    const imported = [];
    const skipped = [];

    for (const row of rows) {
      try {
        const rawDate = row[dateColumn] || row['date'] || row['DATE'] || row['Transaction Date'];
        const desc = row[descColumn] || row['description'] || row['DESC'] || row['Narration'] || '';
        const debit = parseFloat((row[debitColumn] || row['debit'] || row['DEBIT'] || '0').toString().replace(/,/g, '')) || 0;
        const credit = parseFloat((row[creditColumn] || row['credit'] || row['CREDIT'] || '0').toString().replace(/,/g, '')) || 0;
        const balance = parseFloat((row[balanceColumn] || row['balance'] || row['BALANCE'] || '0').toString().replace(/,/g, '')) || undefined;

        if (!rawDate) { skipped.push({ row, reason: 'No date' }); continue; }

        const txDate = new Date(rawDate);
        if (isNaN(txDate)) { skipped.push({ row, reason: 'Invalid date' }); continue; }
        if (debit === 0 && credit === 0) { skipped.push({ row, reason: 'Zero amount' }); continue; }

        const amount = credit - debit;
        const type = amount >= 0 ? 'credit' : 'debit';

        // Avoid duplicate imports
        const exists = account.transactions?.some(t =>
          t.date?.toISOString().split('T')[0] === txDate.toISOString().split('T')[0] &&
          Math.abs((t.amount || 0) - Math.abs(amount)) < 0.01 &&
          (t.description || '').toLowerCase().includes((desc || '').toLowerCase().substring(0, 10))
        );
        if (exists) { skipped.push({ row, reason: 'Duplicate' }); continue; }

        account.transactions = account.transactions || [];
        account.transactions.push({
          date: txDate,
          description: desc,
          amount: Math.abs(amount),
          type,
          balance,
          reference: row['Ref'] || row['Reference'] || row['Cheque No'] || '',
          status: 'unreconciled',
          source: 'imported',
          createdBy: req.user.id
        });

        imported.push({ date: txDate, description: desc, amount: Math.abs(amount), type });
      } catch (err) {
        skipped.push({ reason: err.message });
      }
    }

    // Recalculate running balance
    if (account.transactions?.length) {
      const lastTx = account.transactions[account.transactions.length - 1];
      if (lastTx?.balance) account.currentBalance = lastTx.balance;
    }

    await account.save();

    // Clean up temp file
    if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);

    res.json({
      success: true,
      message: `Imported ${imported.length} transaction(s), skipped ${skipped.length}`,
      data: { imported: imported.length, skipped: skipped.length, skippedRows: skipped.slice(0, 10) }
    });
  })
);

// ═════════════════════════════════════════════════════════════════════════════
// BANK VOUCHER DATES IMPORT (Excel / CSV)
// ═════════════════════════════════════════════════════════════════════════════
router.post('/banking/import-voucher-dates',
  authorize('super_admin', 'admin', 'finance_manager', 'finance_user'),
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });

    const XLSX = require('xlsx');
    const JournalEntry = require('../models/finance/JournalEntry');
    const GeneralLedger = require('../models/finance/GeneralLedger');
    const User = require('../models/User');

    // Parse file
    const workbook = XLSX.readFile(req.file.path, { cellDates: true });
    const sheetName = workbook.SheetNames[0];
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { raw: false, defval: '' });

    const { mode = 'create_missing' } = req.body; // 'dates_only' | 'create_missing'
    const Account = require('../models/finance/Account');
    const PlacementCompany = require('../models/hr/Company');
    const Department = require('../models/hr/Department');

    let fallbackUserId = req.user?._id || req.user?.id;
    if (!fallbackUserId) {
      const defaultUser = await User.findOne({ isActive: true, role: 'super_admin' }) || await User.findOne({ isActive: true });
      if (defaultUser) fallbackUserId = defaultUser._id;
    }

    const parseExcelDate = (val) => {
      if (!val) return null;
      if (val instanceof Date) return val;
      const num = Number(val);
      if (!isNaN(num)) return new Date(Math.round((num - 25569) * 86400 * 1000));
      const parsed = new Date(val);
      return isNaN(parsed.getTime()) ? null : parsed;
    };

    // Fetch default department and fallback company for journal entries
    const defaultDept = await Department.findOne({ isActive: true }) || { _id: null };

    // Helper to resolve or auto-create account
    const accountCache = new Map();
    const resolveAccount = async (code, name) => {
      const cacheKey = `${code}_${name}`.toLowerCase();
      if (accountCache.has(cacheKey)) return accountCache.get(cacheKey);

      let acc = null;
      if (code) {
        acc = await Account.findOne({ $or: [{ accountNumber: String(code).trim() }, { accountCode: String(code).trim() }] });
      }
      if (!acc && name) {
        acc = await Account.findOne({ name: new RegExp(`^${String(name).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') });
      }
      if (!acc && (code || name)) {
        // Auto-create missing account head safely
        const numStr = String(code || '9999').trim();
        const accName = String(name || `Account ${numStr}`).trim();
        const firstDigit = numStr[0];
        let accType = 'Expense';
        let accCat = 'Operating Expense';
        if (firstDigit === '1') { accType = 'Asset'; accCat = 'Current Asset'; }
        else if (firstDigit === '2') { accType = 'Liability'; accCat = 'Current Liability'; }
        else if (firstDigit === '3') { accType = 'Equity'; accCat = 'Equity'; }
        else if (firstDigit === '4') { accType = 'Revenue'; accCat = 'Revenue'; }

        acc = await Account.create({
          accountNumber: numStr,
          accountCode: numStr,
          name: accName,
          type: accType,
          category: accCat,
          balance: 0
        });
      }
      if (acc) accountCache.set(cacheKey, acc);
      return acc;
    };

    // Helper to resolve company ID by code
    const companyCache = new Map();
    const resolveCompany = async (codeStr) => {
      if (!codeStr || !String(codeStr).trim()) return null;
      const clean = String(codeStr).trim().toLowerCase();
      if (companyCache.has(clean)) return companyCache.get(clean);

      const comp = await PlacementCompany.findOne({
        $or: [
          { companyCode: new RegExp(`^${clean}$`, 'i') },
          { name: new RegExp(`^${clean}$`, 'i') }
        ]
      });
      const compId = comp ? comp._id : null;
      companyCache.set(clean, compId);
      return compId;
    };

    // Group Excel rows by Voucher No
    const skipped = [];
    const voucherGroups = new Map();

    const getFuzzyVal = (rowObj, targetKey) => {
      if (!targetKey) return undefined;
      const cleanTarget = String(targetKey).trim().toLowerCase();
      for (const [k, v] of Object.entries(rowObj)) {
        if (String(k).trim().toLowerCase() === cleanTarget) return v;
      }
      return undefined;
    };

    for (const [index, row] of rows.entries()) {
      let rawVNo = getFuzzyVal(row, 'Voucher No') || getFuzzyVal(row, 'Voucher Number') || getFuzzyVal(row, 'VNo') || getFuzzyVal(row, 'Entry Number');

      if (!rawVNo || !String(rawVNo).trim()) {
        // If row is entirely empty or has no financial data, quietly ignore trailing blank Excel rows
        const desc = String(getFuzzyVal(row, 'Description') || '').trim().toLowerCase();
        if (desc === 'total' || desc.includes('difference must be nil')) {
          continue;
        }
        const hasAnyData = Object.values(row).some(v => String(v).trim().length > 0);
        if (hasAnyData) {
          const hasAmount = getFuzzyVal(row, 'Debit') || getFuzzyVal(row, 'Credit');
          if (hasAmount) {
            skipped.push({ rowNumber: index + 2, vNo: '', reason: 'Missing Voucher Number' });
          }
        }
        continue;
      }
      const vNo = String(rawVNo).trim();
      if (!voucherGroups.has(vNo)) voucherGroups.set(vNo, []);
      voucherGroups.get(vNo).push({ row, rowNumber: index + 2 });
    }

    const updated = [];
    const created = [];

    // Helper for regex queries for voucher matching
    const getVNoQueries = (rawStr) => {
      const clean = String(rawStr).trim();
      const escapeRx = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const queries = [{ entryNumber: new RegExp(`^${escapeRx(clean)}$`, 'i') }];

      const match = clean.match(/^([A-Za-z]+)[-\s]*([0-9]+)$/);
      if (match) {
        const series = escapeRx(match[1]);
        const numInt = parseInt(match[2], 10);
        queries.push({ entryNumber: new RegExp(`^${series}(?:-[A-Za-z0-9]+)?-0*${numInt}$`, 'i') });
      }
      return queries;
    };

    for (const [vNo, items] of voucherGroups.entries()) {
      try {
        const firstRow = items[0].row;
        const rawDate = getFuzzyVal(firstRow, 'Date') || getFuzzyVal(firstRow, 'Voucher Date') || getFuzzyVal(firstRow, 'Cheque Clearing Date');
        const parsedDate = parseExcelDate(rawDate) || new Date();

        // 1. Try finding existing voucher
        let journalEntry = await JournalEntry.findOne({ $or: getVNoQueries(vNo) });

        if (journalEntry) {
          // UPDATE EXISTING VOUCHER DATE & CLEARANCE
          const oldDate = journalEntry.date;
          const effectiveCreatedBy = req.user?._id || req.user?.id || fallbackUserId;
          if (!journalEntry.createdBy && effectiveCreatedBy) {
            journalEntry.createdBy = effectiveCreatedBy;
          }
          journalEntry.date = parsedDate;
          journalEntry.clearanceStatus = 'cleared';
          journalEntry.clearedAt = parsedDate;
          await journalEntry.save();

          await GeneralLedger.updateMany(
            { journalEntry: journalEntry._id },
            {
              $set: {
                date: parsedDate,
                clearanceStatus: 'cleared',
                clearedAt: parsedDate,
                ...(effectiveCreatedBy ? { createdBy: effectiveCreatedBy } : {})
              }
            }
          );

          updated.push({
            vNo,
            oldDate,
            newDate: parsedDate,
            action: 'Updated Date'
          });
        } else if (mode === 'create_missing') {
          // CREATE MISSING VOUCHER (BRV, IBT, JV, BPV, etc.)
          const seriesMatch = vNo.match(/^([A-Za-z]+)/);
          const series = seriesMatch ? seriesMatch[1].toUpperCase() : 'JV';

          const lines = [];
          let mainCompanyId = null;
          let mainDescription = firstRow['Description'] || `Imported ${series} Voucher ${vNo}`;
          let customPaymentType = getFuzzyVal(firstRow, 'Payment Type') || '';
          let customMainAccountHead = getFuzzyVal(firstRow, 'Main Account Head') || '';
          let customSubAccountHead = getFuzzyVal(firstRow, 'Sub Account Head') || '';
          let customCompany = getFuzzyVal(firstRow, 'Companies') || '';
          let customProject = getFuzzyVal(firstRow, 'Projects') || '';

          for (const item of items) {
            const r = item.row;
            const accCode = getFuzzyVal(r, 'Account Code');
            const accName = getFuzzyVal(r, 'Account Name');
            const accObj = await resolveAccount(accCode, accName);
            if (!accObj) continue;

            const dr = parseFloat(String(getFuzzyVal(r, 'Debit') || '0').replace(/,/g, '').replace(/-/g, '0')) || 0;
            const cr = parseFloat(String(getFuzzyVal(r, 'Credit') || '0').replace(/,/g, '').replace(/-/g, '0')) || 0;

            const rCompany = getFuzzyVal(r, 'Companies');
            if (rCompany && !mainCompanyId) {
              mainCompanyId = await resolveCompany(rCompany);
            }

            lines.push({
              account: accObj._id,
              description: getFuzzyVal(r, 'Description') || mainDescription,
              debit: dr,
              credit: cr
            });
          }

          if (!lines.length) {
            skipped.push({ vNo, reason: 'No valid account lines found' });
            continue;
          }

          // Format standardized entryNumber (e.g., BRV-000001 or IBT-000001)
          let entryNumber = vNo;
          const matchNum = vNo.match(/^([A-Za-z]+)[-\s]*([0-9]+)$/);
          if (matchNum) {
            entryNumber = `${matchNum[1].toUpperCase()}-${String(matchNum[2]).padStart(6, '0')}`;
          }

          // Check if formatted entryNumber exists to avoid duplicate key error
          const existsFormatted = await JournalEntry.findOne({ entryNumber });
          if (existsFormatted) entryNumber = `${vNo}-${Date.now().toString().slice(-4)}`;

          const effectiveCreatedBy = req.user?._id || req.user?.id || fallbackUserId;

          const newJE = await JournalEntry.create({
            companyId: mainCompanyId,
            entryNumber: entryNumber,
            voucherSeries: series,
            date: parsedDate,
            description: mainDescription,
            reference: firstRow['Cheque No.'] || firstRow['Ref'] || '',
            department: defaultDept._id || 'Finance',
            referenceType: 'manual',
            customPaymentType,
            customMainAccountHead,
            customSubAccountHead,
            customCompany,
            customProject,
            createdBy: effectiveCreatedBy,
            clearanceStatus: 'cleared',
            clearedAt: parsedDate,
            status: 'posted',
            lines
          });

          // Post GL entries
          const glDocs = lines.map(line => ({
            companyId: mainCompanyId,
            journalEntry: newJE._id,
            account: line.account,
            date: parsedDate,
            entryNumber: newJE.entryNumber,
            reference: newJE.reference,
            description: line.description || mainDescription,
            debit: line.debit,
            credit: line.credit,
            createdBy: effectiveCreatedBy,
            module: 'Finance',
            department: 'finance',
            clearanceStatus: 'cleared',
            clearedAt: parsedDate,
            status: 'posted'
          }));

          await GeneralLedger.insertMany(glDocs);

          created.push({
            vNo,
            entryNumber: newJE.entryNumber,
            date: parsedDate,
            action: 'Created Voucher'
          });
        } else {
          skipped.push({ vNo, reason: 'Voucher not found in system' });
        }
      } catch (err) {
        skipped.push({ vNo, reason: err.message });
      }
    }

    // Clean up uploaded temp file
    if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);

    res.json({
      success: true,
      message: `Import Completed: Updated ${updated.length} existing voucher date(s) & created ${created.length} missing voucher(s). Skipped ${skipped.length} row group(s).`,
      data: {
        updatedCount: updated.length,
        createdCount: created.length,
        skippedCount: skipped.length,
        updated,
        created,
        skipped
      }
    });
  })
);

// ═════════════════════════════════════════════════════════════════════════════
// BATCH VENDOR PAYMENTS
// ═════════════════════════════════════════════════════════════════════════════
router.post('/accounts-payable/batch-payment',
  authorize('super_admin', 'admin', 'manager', 'accounts_officer', 'finance_manager', 'finance_controller', 'commercial_director', 'ceo'),
  asyncHandler(async (req, res) => {
    const paymentData = req.body;
    const FinanceHelper = require('../utils/financeHelper');
    const result = await FinanceHelper.recordAPBatchPayment({
      ...paymentData,
      createdBy: req.user._id || req.user.id,
      date: paymentData.paymentDate || new Date()
    });

    res.json({
      success: true,
      message: result.payingJournalEntryId
        ? 'Intercompany batch payment created: original-company voucher + paying-company voucher (both pending finance signatures)'
        : 'Batch payment successfully processed and pending authorization',
      data: result
    });
  })
);

// ═════════════════════════════════════════════════════════════════════════════
// COMPANY PROFILE — GET / PUT via SystemSettings singleton
// ═════════════════════════════════════════════════════════════════════════════
router.get('/company-profile',
  authorize('super_admin', 'admin', 'finance_manager'),
  asyncHandler(async (req, res) => {
    const SystemSettings = require('../models/general/SystemSettings');
    const settings = await SystemSettings.getSingleton();
    res.json({ success: true, data: settings.companyProfile || {} });
  })
);

router.put('/company-profile',
  authorize('super_admin', 'admin'),
  asyncHandler(async (req, res) => {
    const SystemSettings = require('../models/general/SystemSettings');
    const settings = await SystemSettings.getSingleton();
    const allowed = ['name', 'legalName', 'ntn', 'strn', 'address', 'city', 'country',
                     'phone', 'email', 'website', 'logoUrl', 'currency',
                     'bankName', 'bankAccount', 'bankIBAN', 'bankBranchCode', 'bankBranchName',
                     'salaryLetterRefPrefix', 'invoiceFooter'];
    if (!settings.companyProfile) settings.companyProfile = {};
    allowed.forEach(f => { if (req.body[f] !== undefined) settings.companyProfile[f] = req.body[f]; });
    settings.updatedBy = req.user.id;
    settings.markModified('companyProfile');
    await settings.save();
    res.json({ success: true, data: settings.companyProfile, message: 'Company profile saved' });
  })
);

// ═════════════════════════════════════════════════════════════════════════════
// COMPARATIVE PROFIT & LOSS — two periods side-by-side
// ═════════════════════════════════════════════════════════════════════════════
router.get('/reports/comparative-pl',
  authorize('super_admin', 'admin', 'finance_manager'),
  asyncHandler(async (req, res) => {
    const { p1From, p1To, p2From, p2To } = req.query;
    const { jeMatch } = await financeScope(req);

    const getPeriodData = async (fromDate, toDate) => {
      const match = jeMatch({ status: 'posted' });
      if (fromDate) match.date = { ...(match.date || {}), $gte: new Date(fromDate) };
      if (toDate) match.date = { ...(match.date || {}), $lte: new Date(toDate) };

      const rows = await GeneralLedger.aggregate([
        { $match: match },
        {
          $lookup: {
            from: 'accounts', localField: 'account', foreignField: '_id', as: 'acc'
          }
        },
        { $unwind: '$acc' },
        { $match: { 'acc.type': { $in: ['Revenue', 'Expense'] } } },
        {
          $group: {
            _id: '$account',
            accountName: { $first: '$acc.name' },
            accountNumber: { $first: '$acc.accountNumber' },
            accountType: { $first: '$acc.type' },
            totalDebit: { $sum: '$debit' },
            totalCredit: { $sum: '$credit' }
          }
        },
        { $sort: { accountNumber: 1 } }
      ]);

      const revenue = rows.filter(r => r.accountType === 'Revenue');
      const expenses = rows.filter(r => r.accountType === 'Expense');
      const totalRev = revenue.reduce((s, r) => s + ((r.totalCredit || 0) - (r.totalDebit || 0)), 0);
      const totalExp = expenses.reduce((s, r) => s + ((r.totalDebit || 0) - (r.totalCredit || 0)), 0);
      return { revenue, expenses, totalRevenue: totalRev, totalExpenses: totalExp, netProfit: totalRev - totalExp };
    };

    const [period1, period2] = await Promise.all([
      getPeriodData(p1From, p1To),
      getPeriodData(p2From, p2To)
    ]);

    // Merge account lists for aligned display
    const allAccIds = new Set([
      ...period1.revenue.map(r => r._id?.toString()),
      ...period2.revenue.map(r => r._id?.toString()),
      ...period1.expenses.map(r => r._id?.toString()),
      ...period2.expenses.map(r => r._id?.toString())
    ]);

    res.json({
      success: true,
      data: {
        period1: { from: p1From, to: p1To, ...period1 },
        period2: { from: p2From, to: p2To, ...period2 }
      }
    });
  })
);

// ═════════════════════════════════════════════════════════════════════════════
// DEPARTMENT / COST-CENTER P&L — proper revenue vs expense by dept
// ═════════════════════════════════════════════════════════════════════════════
router.get('/reports/department-pl',
  authorize('super_admin', 'admin', 'finance_manager'),
  asyncHandler(async (req, res) => {
    const { department, fromDate, toDate } = req.query;

    const match = { status: 'posted' };
    if (fromDate || toDate) {
      match.date = {};
      if (fromDate) match.date.$gte = new Date(fromDate);
      if (toDate) match.date.$lte = new Date(toDate);
    }
    if (department) match.department = department;

    const rows = await GeneralLedger.aggregate([
      { $match: match },
      {
        $lookup: {
          from: 'accounts', localField: 'account', foreignField: '_id', as: 'acc'
        }
      },
      { $unwind: '$acc' },
      { $match: { 'acc.type': { $in: ['Revenue', 'Expense'] } } },
      {
        $group: {
          _id: { account: '$account', dept: '$department' },
          accountName: { $first: '$acc.name' },
          accountNumber: { $first: '$acc.accountNumber' },
          accountType: { $first: '$acc.type' },
          department: { $first: '$department' },
          totalDebit: { $sum: '$debit' },
          totalCredit: { $sum: '$credit' }
        }
      },
      { $sort: { '_id.dept': 1, accountNumber: 1 } }
    ]);

    // Group by department
    const byDept = {};
    for (const r of rows) {
      const dept = r.department || 'General';
      if (!byDept[dept]) byDept[dept] = { revenue: [], expenses: [], totalRevenue: 0, totalExpenses: 0, netProfit: 0 };
      const balance = r.accountType === 'Revenue'
        ? (r.totalCredit || 0) - (r.totalDebit || 0)
        : (r.totalDebit || 0) - (r.totalCredit || 0);
      const entry = { accountName: r.accountName, accountNumber: r.accountNumber, balance };
      if (r.accountType === 'Revenue') {
        byDept[dept].revenue.push(entry);
        byDept[dept].totalRevenue += balance;
      } else {
        byDept[dept].expenses.push(entry);
        byDept[dept].totalExpenses += balance;
      }
    }
    Object.values(byDept).forEach(d => { d.netProfit = d.totalRevenue - d.totalExpenses; });

    // Also return all unique departments for filter dropdown
    const allDepts = await GeneralLedger.distinct('department', { status: 'posted' });

    res.json({ success: true, data: { byDept, departments: allDepts.filter(Boolean).sort() } });
  })
);

// ═════════════════════════════════════════════════════════════════════════════
// FINANCE ADMIN — RESET & SEED (super_admin only)
// ═════════════════════════════════════════════════════════════════════════════

// Reset all transactional finance data (keeps config like taxes, journals, payment terms)
router.post('/admin/reset-finance',
  authorize('super_admin'),
  asyncHandler(async (req, res) => {
    const { confirm } = req.body;
    if (confirm !== 'RESET_FINANCE') {
      return res.status(400).json({ success: false, message: 'Send { confirm: "RESET_FINANCE" } to confirm' });
    }

    const Inventory = require('../models/procurement/Inventory');
    const SalesOrder = require('../models/sales/SalesOrder');
    const DeferredEntry = require('../models/finance/DeferredEntry');
    const Budget = require('../models/finance/Budget');
    const FixedAsset = require('../models/finance/FixedAsset');

    const results = {};

    // 1. Clear all transactional finance collections
    results.journalEntries = (await JournalEntry.deleteMany({})).deletedCount;
    results.generalLedger = (await GeneralLedger.deleteMany({})).deletedCount;
    results.accountsPayable = (await AccountsPayable.deleteMany({})).deletedCount;
    results.accountsReceivable = (await AccountsReceivable.deleteMany({})).deletedCount;
    results.recurringJournals = (await RecurringJournal.deleteMany({})).deletedCount;
    results.deferredEntries = (await DeferredEntry.deleteMany({})).deletedCount;
    results.budgets = (await Budget.deleteMany({})).deletedCount;
    results.fixedAssets = (await FixedAsset.deleteMany({})).deletedCount;

    // 2. Clear Chart of Accounts
    results.accounts = (await Account.deleteMany({})).deletedCount;

    // 3. Clear banking transactions but keep bank account records intact
    await Banking.updateMany({}, { $set: { transactions: [], currentBalance: 0, availableBalance: 0 } });
    results.bankingTransactions = 'cleared (accounts kept)';

    // 4. Reset procurement finance flags on GRNs
    const GRN = require('../models/procurement/GoodsReceive');
    await GRN.updateMany({}, {
      $unset: { vendorBill: 1, vendorBillNumber: 1, journalEntry: 1 },
      $set: { billingStatus: 'waiting_bills', financePosted: false }
    });
    results.grnsReset = 'billingStatus reset, finance links cleared';

    // 5. Reset AR invoice links on Sales Orders
    await SalesOrder.updateMany({}, {
      $unset: { arInvoice: 1, arInvoiceNumber: 1 },
      $set: { billingStatus: 'not_billed' }
    });
    results.salesOrdersReset = 'AR invoice links cleared';

    // 6. Reset inventory stock quantities and costs to zero
    await Inventory.updateMany({}, {
      $set: { quantity: 0, averageCost: 0, totalValue: 0, status: 'out_of_stock', stockTransactions: [] }
    });
    results.inventoryReset = 'all stock quantities and costs reset to zero';

    console.log('[FinanceReset] Complete reset performed by:', req.user?.email);
    res.json({ success: true, message: '✅ Finance module fully reset. Ready for fresh setup.', data: results });
  })
);

// Seed standard Pakistan-ready Chart of Accounts
router.post('/admin/seed-accounts',
  authorize('super_admin'),
  asyncHandler(async (req, res) => {
    // Check if accounts already exist
    const existing = await Account.countDocuments();
    if (existing > 0) {
      return res.status(400).json({
        success: false,
        message: `${existing} accounts already exist. Reset finance first, or delete accounts manually.`
      });
    }

    const uid = req.user.id;

    const standardAccounts = [
      // ── ASSETS ──────────────────────────────────────────────────────
      // Current Assets
      { accountNumber: '1010', name: 'Cash in Hand', type: 'Asset', category: 'Current Asset', isSystemAccount: false },
      { accountNumber: '1020', name: 'Bank Account – Main (HBL)', type: 'Asset', category: 'Current Asset', isSystemAccount: true },
      { accountNumber: '1030', name: 'Bank Account – Secondary', type: 'Asset', category: 'Current Asset', isSystemAccount: false },
      { accountNumber: '1100', name: 'Accounts Receivable', type: 'Asset', category: 'Current Asset', isSystemAccount: true },
      { accountNumber: '1110', name: 'Advance to Suppliers', type: 'Asset', category: 'Current Asset', isSystemAccount: false },
      { accountNumber: '1200', name: 'Raw Materials Inventory', type: 'Asset', category: 'Current Asset', isSystemAccount: true },
      { accountNumber: '1210', name: 'Work in Progress', type: 'Asset', category: 'Current Asset', isSystemAccount: false },
      { accountNumber: '1220', name: 'Finished Goods Inventory', type: 'Asset', category: 'Current Asset', isSystemAccount: false },
      { accountNumber: '1300', name: 'GST Input Tax Recoverable', type: 'Asset', category: 'Current Asset', isSystemAccount: true },
      { accountNumber: '1310', name: 'Prepaid Expenses', type: 'Asset', category: 'Current Asset', isSystemAccount: false },
      { accountNumber: '1320', name: 'Other Current Assets', type: 'Asset', category: 'Current Asset', isSystemAccount: false },
      // Non-Current Assets
      { accountNumber: '1500', name: 'Land & Buildings', type: 'Asset', category: 'Fixed Asset', isSystemAccount: false },
      { accountNumber: '1510', name: 'Plant & Machinery', type: 'Asset', category: 'Fixed Asset', isSystemAccount: false },
      { accountNumber: '1520', name: 'Vehicles', type: 'Asset', category: 'Fixed Asset', isSystemAccount: false },
      { accountNumber: '1530', name: 'Furniture & Fixtures', type: 'Asset', category: 'Fixed Asset', isSystemAccount: false },
      { accountNumber: '1540', name: 'Computer & IT Equipment', type: 'Asset', category: 'Fixed Asset', isSystemAccount: false },
      { accountNumber: '1590', name: 'Accumulated Depreciation', type: 'Asset', category: 'Fixed Asset', isSystemAccount: true },

      // ── LIABILITIES ─────────────────────────────────────────────────
      // Current Liabilities
      { accountNumber: '2100', name: 'Accounts Payable', type: 'Liability', category: 'Current Liability', isSystemAccount: true },
      { accountNumber: '2110', name: 'WHT Payable (FBR)', type: 'Liability', category: 'Current Liability', isSystemAccount: true },
      { accountNumber: '2120', name: 'GST / Sales Tax Payable', type: 'Liability', category: 'Current Liability', isSystemAccount: true },
      { accountNumber: '2130', name: 'Salary & Wages Payable', type: 'Liability', category: 'Current Liability', isSystemAccount: true },
      { accountNumber: '2140', name: 'GRNI – Goods Received Not Invoiced', type: 'Liability', category: 'Current Liability', isSystemAccount: true },
      { accountNumber: '2150', name: 'Advance from Customers', type: 'Liability', category: 'Current Liability', isSystemAccount: false },
      { accountNumber: '2160', name: 'Deferred Revenue', type: 'Liability', category: 'Current Liability', isSystemAccount: false },
      { accountNumber: '2170', name: 'EOBI Payable', type: 'Liability', category: 'Current Liability', isSystemAccount: false },
      { accountNumber: '2180', name: 'PESSI / SESSI Payable', type: 'Liability', category: 'Current Liability', isSystemAccount: false },
      { accountNumber: '2190', name: 'Other Current Liabilities', type: 'Liability', category: 'Current Liability', isSystemAccount: false },
      // Non-Current Liabilities
      { accountNumber: '2500', name: 'Long-Term Loan', type: 'Liability', category: 'Long-term Liability', isSystemAccount: false },

      // ── EQUITY ──────────────────────────────────────────────────────
      { accountNumber: '3000', name: 'Share Capital', type: 'Equity', category: 'Equity', isSystemAccount: false },
      { accountNumber: '3100', name: 'Retained Earnings', type: 'Equity', category: 'Equity', isSystemAccount: true },
      { accountNumber: '3200', name: 'Current Year Profit / Loss', type: 'Equity', category: 'Equity', isSystemAccount: true },
      { accountNumber: '3300', name: 'Owner Drawings', type: 'Equity', category: 'Equity', isSystemAccount: false },

      // ── REVENUE ─────────────────────────────────────────────────────
      { accountNumber: '4000', name: 'Sales Revenue', type: 'Revenue', category: 'Revenue', isSystemAccount: true },
      { accountNumber: '4100', name: 'Service Revenue', type: 'Revenue', category: 'Revenue', isSystemAccount: false },
      { accountNumber: '4200', name: 'Other Income', type: 'Revenue', category: 'Revenue', isSystemAccount: false },
      { accountNumber: '4300', name: 'Interest Income', type: 'Revenue', category: 'Revenue', isSystemAccount: false },

      // ── EXPENSES ────────────────────────────────────────────────────
      // Cost of Goods Sold
      { accountNumber: '5000', name: 'Cost of Goods Sold (COGS)', type: 'Expense', category: 'Cost of Revenue', isSystemAccount: true },
      { accountNumber: '5100', name: 'Direct Materials Cost', type: 'Expense', category: 'Cost of Revenue', isSystemAccount: false },
      { accountNumber: '5200', name: 'Direct Labour Cost', type: 'Expense', category: 'Cost of Revenue', isSystemAccount: false },
      // Operating Expenses
      { accountNumber: '6000', name: 'Salaries & Wages', type: 'Expense', category: 'Operating Expense', isSystemAccount: true },
      { accountNumber: '6010', name: 'EOBI Expense', type: 'Expense', category: 'Operating Expense', isSystemAccount: false },
      { accountNumber: '6020', name: 'PESSI / SESSI Expense', type: 'Expense', category: 'Operating Expense', isSystemAccount: false },
      { accountNumber: '6100', name: 'Rent Expense', type: 'Expense', category: 'Operating Expense', isSystemAccount: false },
      { accountNumber: '6200', name: 'Utilities (Electricity/Gas)', type: 'Expense', category: 'Operating Expense', isSystemAccount: false },
      { accountNumber: '6300', name: 'Fuel & Transport', type: 'Expense', category: 'Operating Expense', isSystemAccount: false },
      { accountNumber: '6400', name: 'Repairs & Maintenance', type: 'Expense', category: 'Operating Expense', isSystemAccount: false },
      { accountNumber: '6500', name: 'Depreciation Expense', type: 'Expense', category: 'Operating Expense', isSystemAccount: true },
      { accountNumber: '6600', name: 'Insurance Expense', type: 'Expense', category: 'Operating Expense', isSystemAccount: false },
      { accountNumber: '6700', name: 'Office Supplies & Stationery', type: 'Expense', category: 'Operating Expense', isSystemAccount: false },
      { accountNumber: '6800', name: 'Communication & Internet', type: 'Expense', category: 'Operating Expense', isSystemAccount: false },
      { accountNumber: '6900', name: 'Travel & Conveyance', type: 'Expense', category: 'Operating Expense', isSystemAccount: false },
      { accountNumber: '7000', name: 'Professional Fees (Legal/Audit)', type: 'Expense', category: 'Operating Expense', isSystemAccount: false },
      { accountNumber: '7100', name: 'Bank Charges & Interest', type: 'Expense', category: 'Operating Expense', isSystemAccount: false },
      { accountNumber: '7200', name: 'Income Tax Expense', type: 'Expense', category: 'Operating Expense', isSystemAccount: false },
      { accountNumber: '7300', name: 'Miscellaneous Expense', type: 'Expense', category: 'Operating Expense', isSystemAccount: false },
    ];

    const created = await Account.insertMany(
      standardAccounts.map(a => ({ ...a, createdBy: uid, description: a.name }))
    );

    res.json({
      success: true,
      message: `✅ ${created.length} standard accounts created successfully`,
      data: {
        total: created.length,
        byType: {
          Assets: created.filter(a => a.type === 'Asset').length,
          Liabilities: created.filter(a => a.type === 'Liability').length,
          Equity: created.filter(a => a.type === 'Equity').length,
          Revenue: created.filter(a => a.type === 'Revenue').length,
          Expenses: created.filter(a => a.type === 'Expense').length,
        },
        criticalAccounts: created
          .filter(a => a.isSystemAccount)
          .map(a => ({ number: a.accountNumber, name: a.name, type: a.type }))
      }
    });
  })
);

// ═════════════════════════════════════════════════════════════════════════════
// JOURNAL ENTRY ATTACHMENTS
// ═════════════════════════════════════════════════════════════════════════════

// Upload attachment to a journal entry
router.post('/journal-entries/:id/attachments',
  authorize('super_admin', 'admin', 'finance_manager'),
  upload.single('file'),
  asyncHandler(async (req, res) => {
    const entry = await JournalEntry.findById(req.params.id);
    if (!entry) return res.status(404).json({ success: false, message: 'Journal entry not found' });
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });

    const attachment = {
      filename: req.file.filename,
      originalName: req.file.originalname,
      path: `/uploads/finance/${req.file.filename}`,
      uploadedBy: req.user.id,
      uploadedAt: new Date(),
      size: req.file.size,
      mimetype: req.file.mimetype
    };

    entry.attachments = entry.attachments || [];
    entry.attachments.push(attachment);
    await entry.save();

    res.json({ success: true, message: 'Attachment uploaded', data: attachment });
  })
);

// Delete attachment from a journal entry
router.delete('/journal-entries/:id/attachments/:filename',
  authorize('super_admin', 'admin', 'finance_manager'),
  asyncHandler(async (req, res) => {
    const entry = await JournalEntry.findById(req.params.id);
    if (!entry) return res.status(404).json({ success: false, message: 'Not found' });

    const idx = entry.attachments.findIndex(a => a.filename === req.params.filename);
    if (idx === -1) return res.status(404).json({ success: false, message: 'Attachment not found' });

    // Delete file from disk
    const filePath = path.join(__dirname, '..', 'uploads', 'finance', req.params.filename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

    entry.attachments.splice(idx, 1);
    if (!entry.attachments.length) {
      entry.signedDocumentStatus = 'not_signed';
      entry.signedDocumentAt = null;
      entry.clearanceStatus = 'pending';
      entry.clearedAt = null;
      entry.clearedBy = null;
      entry.clearanceRemarks = '';
    }
    await entry.save();
    const fresh = await JournalEntry.findById(entry._id).lean();
    res.json({ success: true, message: 'Attachment deleted', data: fresh });
  })
);

// @route   GET /api/finance/payroll-queue
// @desc    AVP-approved monthly payroll periods awaiting finance processing
router.get('/payroll-queue',
  authorize('super_admin', 'admin', 'finance_manager'),
  asyncHandler(async (req, res) => {
    const queue = await listFinancePayrollQueue();
    res.json({ success: true, data: queue });
  })
);

// @route   GET /api/finance/payroll-queue/:month/:year
router.get('/payroll-queue/:month/:year',
  authorize('super_admin', 'admin', 'finance_manager'),
  asyncHandler(async (req, res) => {
    const detail = await getFinancePayrollPeriodDetail(req.params.month, req.params.year);
    res.json({ success: true, data: detail });
  })
);

// @route   GET /api/finance/payroll-queue/:month/:year/bank-letter
router.get('/payroll-queue/:month/:year/bank-letter',
  authorize('super_admin', 'admin', 'finance_manager'),
  asyncHandler(async (req, res) => {
    const letter = await getFinancePayrollBankLetter(req.params.month, req.params.year);
    res.json({ success: true, data: letter });
  })
);

// @route   GET /api/finance/payroll-queue/:month/:year/bank-letters
router.get('/payroll-queue/:month/:year/bank-letters',
  authorize('super_admin', 'admin', 'finance_manager'),
  asyncHandler(async (req, res) => {
    const letters = await PayrollBankLetterService.listBankLettersForPeriod(
      req.params.month,
      req.params.year,
      { companyName: req.query.companyName }
    );
    res.json({ success: true, data: letters });
  })
);

// @route   POST /api/finance/payroll-queue/:month/:year/bank-letter/generate
router.post('/payroll-queue/:month/:year/bank-letter/generate',
  authorize('super_admin', 'admin', 'finance_manager'),
  [
    body('companyName').notEmpty().withMessage('Company is required'),
    body('format').optional().isIn(['print', 'excel']).withMessage('Invalid format')
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });
    }
    const result = await PayrollBankLetterService.generateBankLetterForCompanyPayment(
      req.params.month,
      req.params.year,
      req.body.companyName,
      {
        format: req.body.format || 'print',
        generatedBy: req.user._id || req.user.id
      }
    );
    res.json({
      success: true,
      message: 'Bank letter generated and recorded',
      data: {
        letter: result.letter,
        company: result.company,
        record: result.record
      }
    });
  })
);

// @route   POST /api/finance/payroll-period-payments/:id/bank-letter/generate
router.post('/payroll-period-payments/:id/bank-letter/generate',
  authorize('super_admin', 'admin', 'finance_manager'),
  [
    body('format').optional().isIn(['print', 'excel']).withMessage('Invalid format')
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });
    }
    const result = await PayrollBankLetterService.generateBankLetterForPayment(
      req.params.id,
      {
        format: req.body.format || 'print',
        generatedBy: req.user._id || req.user.id
      }
    );
    res.json({
      success: true,
      message: 'Bank letter generated and recorded',
      data: {
        letter: result.letter,
        company: result.company,
        record: result.record
      }
    });
  })
);

// @route   GET /api/finance/payroll-period-payments/:id/bank-letter/preview
router.get('/payroll-period-payments/:id/bank-letter/preview',
  authorize('super_admin', 'admin', 'finance_manager'),
  asyncHandler(async (req, res) => {
    const app = await PayrollPeriodPaymentHelper.populateApplication({ _id: req.params.id });
    if (!app) {
      return res.status(404).json({ success: false, message: 'Payroll payment not found' });
    }
    const payload = await PayrollBankLetterService.buildLetterPayload(app);
    res.json({ success: true, data: payload });
  })
);

// @route   POST /api/finance/payroll-queue/:month/:year/save-draft
router.post('/payroll-queue/:month/:year/save-draft',
  authorize('super_admin', 'admin', 'finance_manager'),
  [
    body('companyName').notEmpty().withMessage('Company is required'),
    body('paymentMethod').optional().isIn(['bank_transfer', 'cash', 'check']).withMessage('Invalid payment method'),
    body('draftId').optional()
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });
    }
    const result = await PayrollPeriodPaymentHelper.savePayrollPeriodPaymentDraft(
      req.params.month,
      req.params.year,
      {
        companyName: req.body.companyName,
        paymentMethod: req.body.paymentMethod || 'bank_transfer',
        reference: req.body.reference || '',
        narration: req.body.narration || '',
        paymentDate: req.body.paymentDate,
        bankAccountId: req.body.bankAccountId || null,
        draftId: req.body.draftId || null,
        createdBy: req.user._id
      }
    );
    res.json({
      success: true,
      message: `Payroll payment draft saved for ${result.companyName}. Review the BPV, then submit for GM Finance approval when ready.`,
      data: result
    });
  })
);

// @route   POST /api/finance/payroll-period-payments/:id/submit
router.post('/payroll-period-payments/:id/submit',
  authorize('super_admin', 'admin', 'finance_manager'),
  [
    body('financeControllerUser').notEmpty().withMessage('GM Finance is required'),
    body('paymentMethod').optional().isIn(['bank_transfer', 'cash', 'check']).withMessage('Invalid payment method'),
    body('financeApprovalAuthorities.financeControllerUser').optional()
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });
    }
    const financeControllerUser =
      req.body.financeControllerUser
      || req.body.financeApprovalAuthorities?.financeControllerUser;
    const result = await PayrollPeriodPaymentHelper.submitPayrollPeriodPaymentDraft(
      req.params.id,
      {
        paymentMethod: req.body.paymentMethod,
        reference: req.body.reference,
        narration: req.body.narration,
        paymentDate: req.body.paymentDate,
        bankAccountId: req.body.bankAccountId || null,
        financeControllerUser,
        actorId: req.user._id
      }
    );
    res.json({
      success: true,
      message: `Payroll payment for ${result.companyName} submitted (gross ${Number(result.grossSalary || 0).toLocaleString('en-PK')}, net bank ${Number(result.pendingAmount || 0).toLocaleString('en-PK')}). BPV is pending GM Finance approval — ${result.companyName} payroll will be marked paid after approval.`,
      data: result
    });
  })
);

// @route   DELETE /api/finance/payroll-period-payments/:id
router.delete('/payroll-period-payments/:id',
  authorize('super_admin', 'admin', 'finance_manager'),
  asyncHandler(async (req, res) => {
    const result = await PayrollPeriodPaymentHelper.deletePayrollPeriodPaymentDraft(req.params.id);
    res.json({
      success: true,
      message: `Draft payroll payment for ${result.companyName} (${result.periodLabel}) and its BPV draft were deleted.`,
      data: result
    });
  })
);

// @route   POST /api/finance/payroll-queue/:month/:year/make-payment
router.post('/payroll-queue/:month/:year/make-payment',
  authorize('super_admin', 'admin', 'finance_manager'),
  [
    body('companyName').notEmpty().withMessage('Company is required'),
    body('paymentMethod').optional().isIn(['bank_transfer', 'cash', 'check']).withMessage('Invalid payment method'),
    body('financeControllerUser').notEmpty().withMessage('GM Finance is required'),
    body('financeApprovalAuthorities.financeControllerUser').optional()
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });
    }
    const financeControllerUser =
      req.body.financeControllerUser
      || req.body.financeApprovalAuthorities?.financeControllerUser;
    const draft = await PayrollPeriodPaymentHelper.savePayrollPeriodPaymentDraft(
      req.params.month,
      req.params.year,
      {
        companyName: req.body.companyName,
        paymentMethod: req.body.paymentMethod || 'bank_transfer',
        reference: req.body.reference || '',
        narration: req.body.narration || '',
        paymentDate: req.body.paymentDate,
        bankAccountId: req.body.bankAccountId || null,
        draftId: req.body.draftId || null,
        createdBy: req.user._id
      }
    );
    const result = await PayrollPeriodPaymentHelper.submitPayrollPeriodPaymentDraft(
      draft.application._id,
      {
        paymentMethod: req.body.paymentMethod || 'bank_transfer',
        reference: req.body.reference || '',
        narration: req.body.narration || '',
        paymentDate: req.body.paymentDate,
        bankAccountId: req.body.bankAccountId || null,
        financeControllerUser,
        actorId: req.user._id
      }
    );
    res.json({
      success: true,
      message: `Payroll payment for ${result.companyName} submitted (gross ${Number(result.grossSalary || 0).toLocaleString('en-PK')}, net bank ${Number(result.pendingAmount || 0).toLocaleString('en-PK')}). BPV is pending GM Finance approval — ${result.companyName} payroll will be marked paid after approval.`,
      data: result
    });
  })
);

// @route   POST /api/finance/payroll-queue/:month/:year/mark-paid
router.post('/payroll-queue/:month/:year/mark-paid',
  authorize('super_admin', 'admin', 'finance_manager'),
  [
    body('paymentMethod').optional().isIn(['bank_transfer', 'cash', 'check']).withMessage('Invalid payment method')
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });
    }
    const result = await markFinancePayrollPeriodPaid(req.params.month, req.params.year, {
      paymentMethod: req.body.paymentMethod || 'bank_transfer',
      actorId: req.user.id
    });
    res.json({
      success: true,
      message: `${result.paid} payroll record(s) marked as paid${result.failed ? `; ${result.failed} failed` : ''}.`,
      data: result
    });
  })
);

// @route   GET /api/finance/payroll-period-payments/by-journal-entry/:journalEntryId
router.get('/payroll-period-payments/by-journal-entry/:journalEntryId',
  authorize('super_admin', 'admin', 'finance_manager'),
  asyncHandler(async (req, res) => {
    const doc = await PayrollPeriodPaymentHelper.populateApplication({ journalEntryId: req.params.journalEntryId });
    if (!doc) {
      return res.status(404).json({ success: false, message: 'Payroll payment not found for this voucher' });
    }
    res.json({ success: true, data: doc.toObject ? doc.toObject() : doc });
  })
);

// @route   PUT /api/finance/payroll-period-payments/:id/finance-approve
router.put('/payroll-period-payments/:id/finance-approve',
  authorize('super_admin', 'admin', 'finance_manager'),
  asyncHandler(async (req, res) => {
    const PayrollPeriodPaymentApplication = require('../models/finance/PayrollPeriodPaymentApplication');
    const app = await PayrollPeriodPaymentApplication.findById(req.params.id);
    if (!app) return res.status(404).json({ success: false, message: 'Payroll payment not found' });
    const { remaining, finalized } = await PayrollPeriodPaymentHelper.recordAuthorityApproval(
      app,
      req.user,
      req.body?.comments || ''
    );
    const fresh = await PayrollPeriodPaymentHelper.populateApplication({ _id: app._id });
    const message = finalized
      ? `All finance authorities approved. BPV posted and ${fresh?.companyName || 'company'} payroll marked paid.`
      : `Finance authority recorded. ${remaining} approval(s) remaining before payroll is marked paid.`;
    res.json({ success: true, message, data: fresh?.toObject ? fresh.toObject() : fresh });
  })
);

// @route   PUT /api/finance/payroll-period-payments/:id/finance-reject
router.put('/payroll-period-payments/:id/finance-reject',
  authorize('super_admin', 'admin', 'finance_manager'),
  asyncHandler(async (req, res) => {
    const PayrollPeriodPaymentApplication = require('../models/finance/PayrollPeriodPaymentApplication');
    const app = await PayrollPeriodPaymentApplication.findById(req.params.id);
    if (!app) return res.status(404).json({ success: false, message: 'Payroll payment not found' });
    await PayrollPeriodPaymentHelper.recordAuthorityRejection(app, req.user, req.body?.comments || req.body?.rejectionComments || req.body?.observation || '');
    const fresh = await PayrollPeriodPaymentHelper.populateApplication({ _id: app._id });
    res.json({
      success: true,
      message: 'Payroll payment rejected with observation. Draft BPV cancelled; company payroll remains unpaid. Sr Manager Accounts can correct and resubmit.',
      data: fresh?.toObject ? fresh.toObject() : fresh
    });
  })
);

// ─── Manual Salary Finance Queue ─────────────────────────────────────────────

// @route   GET /api/finance/manual-salary-queue
router.get('/manual-salary-queue',
  authorize('super_admin', 'admin', 'finance_manager'),
  asyncHandler(async (req, res) => {
    const queue = await listManualSalaryFinanceQueue();
    res.json({ success: true, data: queue });
  })
);

// @route   GET /api/finance/manual-salary-queue/:month/:year
router.get('/manual-salary-queue/:month/:year',
  authorize('super_admin', 'admin', 'finance_manager'),
  asyncHandler(async (req, res) => {
    const detail = await getManualSalaryFinancePeriodDetail(req.params.month, req.params.year);
    res.json({ success: true, data: detail });
  })
);

const resolveManualSalaryPaymentCompany = async (req) => {
  let companyId = req.body.payingCompanyId || req.body.companyId || null;
  let companyName = req.body.companyName || '';
  try {
    const scoped = await requireCompanyFromRequest(req);
    if (scoped?._id && !companyId) companyId = scoped._id;
    if (scoped?.name && !companyName) companyName = scoped.name;
  } catch (_e) {
    /* company optional */
  }
  return { companyId, companyName };
};

// @route   POST /api/finance/manual-salary-queue/:month/:year/save-draft
router.post('/manual-salary-queue/:month/:year/save-draft',
  authorize('super_admin', 'admin', 'finance_manager'),
  [
    body('paymentMethod').optional().isIn(['bank_transfer', 'cash', 'check']).withMessage('Invalid payment method'),
    body('draftId').optional()
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });
    }
    const { companyId, companyName } = await resolveManualSalaryPaymentCompany(req);
    const result = await saveManualSalaryPaymentDraft(req.params.month, req.params.year, {
      paymentMethod: req.body.paymentMethod || 'bank_transfer',
      reference: req.body.reference || '',
      narration: req.body.narration || '',
      paymentDate: req.body.paymentDate,
      bankAccountId: req.body.bankAccountId || null,
      companyId,
      companyName,
      draftId: req.body.draftId || null,
      createdBy: req.user._id || req.user.id,
      actorId: req.user._id || req.user.id
    });
    res.json({
      success: true,
      message: `Manual salary payment draft saved for ${result.periodLabel}. Review the BPV, then submit for GM Finance approval when ready.`,
      data: result
    });
  })
);

// @route   POST /api/finance/manual-salary-payments/:id/submit
router.post('/manual-salary-payments/:id/submit',
  authorize('super_admin', 'admin', 'finance_manager'),
  [
    body('financeControllerUser').notEmpty().withMessage('GM Finance is required'),
    body('paymentMethod').optional().isIn(['bank_transfer', 'cash', 'check']).withMessage('Invalid payment method')
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });
    }
    const financeControllerUser =
      req.body.financeControllerUser
      || req.body.financeApprovalAuthorities?.financeControllerUser;
    const { companyId, companyName } = await resolveManualSalaryPaymentCompany(req);
    const result = await submitManualSalaryPaymentDraft(req.params.id, {
      financeControllerUser,
      paymentMethod: req.body.paymentMethod,
      reference: req.body.reference,
      narration: req.body.narration,
      paymentDate: req.body.paymentDate,
      bankAccountId: req.body.bankAccountId || null,
      companyId,
      companyName,
      actorId: req.user._id || req.user.id
    });
    res.json({
      success: true,
      message: `Manual salary payment for ${result.periodLabel} submitted (gross ${Number(result.grossSalary || 0).toLocaleString('en-PK')}, net ${Number(result.pendingAmount || 0).toLocaleString('en-PK')}). BPV is pending GM Finance approval.`,
      data: result
    });
  })
);

// @route   DELETE /api/finance/manual-salary-payments/:id
router.delete('/manual-salary-payments/:id',
  authorize('super_admin', 'admin', 'finance_manager'),
  asyncHandler(async (req, res) => {
    const result = await deleteManualSalaryPaymentDraft(req.params.id);
    res.json({
      success: true,
      message: `Draft manual salary payment for ${result.periodLabel} and its BPV draft were deleted.`,
      data: result
    });
  })
);

// @route   POST /api/finance/manual-salary-queue/:month/:year/make-payment
router.post('/manual-salary-queue/:month/:year/make-payment',
  authorize('super_admin', 'admin', 'finance_manager'),
  [
    body('financeControllerUser').notEmpty().withMessage('GM Finance is required'),
    body('paymentMethod').optional().isIn(['bank_transfer', 'cash', 'check']).withMessage('Invalid payment method')
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });
    }
    const financeControllerUser =
      req.body.financeControllerUser
      || req.body.financeApprovalAuthorities?.financeControllerUser;
    const { companyId, companyName } = await resolveManualSalaryPaymentCompany(req);
    const result = await submitManualSalaryPayment(req.params.month, req.params.year, {
      financeControllerUser,
      paymentMethod: req.body.paymentMethod || 'bank_transfer',
      reference: req.body.reference || '',
      narration: req.body.narration || '',
      paymentDate: req.body.paymentDate,
      bankAccountId: req.body.bankAccountId || null,
      companyId,
      companyName,
      actorId: req.user._id || req.user.id,
      createdBy: req.user._id || req.user.id,
      draftId: req.body.draftId || null
    });
    res.json({
      success: true,
      message: `Manual salary payment for ${result.periodLabel} submitted (${result.employeeCount} employees, net ${Number(result.pendingAmount || 0).toLocaleString('en-PK')}). BPV pending GM Finance approval.`,
      data: result
    });
  })
);

// @route   GET /api/finance/manual-salary-payments/by-journal-entry/:journalEntryId
router.get('/manual-salary-payments/by-journal-entry/:journalEntryId',
  authorize('super_admin', 'admin', 'finance_manager'),
  asyncHandler(async (req, res) => {
    const doc = await populateManualSalaryPaymentApp({ journalEntryId: req.params.journalEntryId });
    if (!doc) {
      return res.status(404).json({ success: false, message: 'Manual salary payment not found for this voucher' });
    }
    res.json({ success: true, data: doc.toObject ? doc.toObject() : doc });
  })
);

// @route   PUT /api/finance/manual-salary-payments/:id/finance-approve
router.put('/manual-salary-payments/:id/finance-approve',
  authorize('super_admin', 'admin', 'finance_manager'),
  asyncHandler(async (req, res) => {
    const ManualSalaryPaymentApplication = require('../models/finance/ManualSalaryPaymentApplication');
    const app = await ManualSalaryPaymentApplication.findById(req.params.id);
    if (!app) return res.status(404).json({ success: false, message: 'Manual salary payment not found' });
    if (app.workflowStatus !== 'pending_authority') {
      return res.status(400).json({
        success: false,
        message: `Cannot approve when status is ${app.workflowStatus}`
      });
    }
    const { remaining, finalized } = await recordManualSalaryAuthorityApproval(
      app,
      req.user,
      req.body?.comments || ''
    );
    const fresh = await populateManualSalaryPaymentApp({ _id: app._id });
    const message = finalized
      ? `All finance authorities approved. BPV posted and manual salary marked Paid.`
      : `Finance authority recorded. ${remaining} approval(s) remaining before manual salary is marked paid.`;
    res.json({ success: true, message, data: fresh?.toObject ? fresh.toObject() : fresh });
  })
);

// @route   PUT /api/finance/manual-salary-payments/:id/finance-reject
router.put('/manual-salary-payments/:id/finance-reject',
  authorize('super_admin', 'admin', 'finance_manager'),
  asyncHandler(async (req, res) => {
    const ManualSalaryPaymentApplication = require('../models/finance/ManualSalaryPaymentApplication');
    const app = await ManualSalaryPaymentApplication.findById(req.params.id);
    if (!app) return res.status(404).json({ success: false, message: 'Manual salary payment not found' });
    await recordManualSalaryAuthorityRejection(
      app,
      req.user,
      req.body?.comments || req.body?.rejectionComments || req.body?.observation || ''
    );
    const fresh = await populateManualSalaryPaymentApp({ _id: app._id });
    res.json({
      success: true,
      message: 'Manual salary payment rejected. Draft BPV cancelled; sheets returned to Pending Finance.',
      data: fresh?.toObject ? fresh.toObject() : fresh
    });
  })
);

// @route   GET /api/finance/banking-setup
// @desc    Get global banking setup options (Payment Types, Main Heads, Sub Heads) - shared across all companies
// @access  Private (Finance and Admin)
router.get('/banking-setup',
  authorize('super_admin', 'admin', 'finance_manager'),
  asyncHandler(async (req, res) => {
    let setup = await BankingSetup.findOne().lean();
    if (!setup) {
      setup = await BankingSetup.create({
        paymentTypes: ['BPV', 'BRV', 'CPV', 'CRV', 'Online Transfer', 'Cheque', 'Pay Order', 'Direct Deposit', 'Misc Receipt'],
        mainAccountHeads: ['Bank Charges', 'Current Assets', 'Current Liabilities', 'Operational Expenses', 'Revenue'],
        subAccountHeads: ['Bank Charges', 'Cash in Hand', 'Petty Cash', 'Vendor Settlement']
      });
    }
    res.json({ success: true, data: setup });
  })
);

// @route   PUT /api/finance/banking-setup
// @desc    Update global banking setup options - applies globally to all companies
// @access  Private (Finance and Admin)
router.put('/banking-setup',
  authorize('super_admin', 'admin', 'finance_manager'),
  asyncHandler(async (req, res) => {
    const { paymentTypes, mainAccountHeads, subAccountHeads } = req.body;

    const updateDoc = {};
    if (Array.isArray(paymentTypes)) {
      updateDoc.paymentTypes = [...new Set(paymentTypes.map(s => String(s || '').trim()).filter(Boolean))];
    }
    if (Array.isArray(mainAccountHeads)) {
      updateDoc.mainAccountHeads = [...new Set(mainAccountHeads.map(s => String(s || '').trim()).filter(Boolean))];
    }
    if (Array.isArray(subAccountHeads)) {
      updateDoc.subAccountHeads = [...new Set(subAccountHeads.map(s => String(s || '').trim()).filter(Boolean))];
    }

    const setup = await BankingSetup.findOneAndUpdate(
      {},
      { $set: updateDoc },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    ).lean();

    res.json({ success: true, message: 'Banking setup updated successfully for all companies', data: setup });
  })
);

module.exports = router;
