/**
 * Finance → Approvals: every document waiting on the logged-in user's finance authority signature
 * (Accounts Officer / AM, Sr Manager Accounts, GM Finance), from all document types in one list.
 *
 * Read-only: approving and returning use each document's own finance-approve / finance-reject endpoint,
 * so the rules stay exactly as they are on the voucher pages. Signing order is not enforced there
 * (any assigned authority can sign at any time), so a document shows for every signer who has not signed.
 */
const express = require('express');
const mongoose = require('mongoose');
const { asyncHandler } = require('../middleware/errorHandler');
const { FINANCE_AUTHORITY_SLOT_CONFIG } = require('../utils/financeAuthoritySlots');
const CashApproval = require('../models/procurement/CashApproval');
const JournalEntry = require('../models/finance/JournalEntry');
const VendorAdvance = require('../models/finance/VendorAdvance');
const ApPaymentApplication = require('../models/finance/ApPaymentApplication');
const PayrollPeriodPaymentApplication = require('../models/finance/PayrollPeriodPaymentApplication');
const ManualSalaryPaymentApplication = require('../models/finance/ManualSalaryPaymentApplication');
// Registered for the populates below
require('../models/User');
require('../models/hr/Supplier');
require('../models/finance/AccountsPayable');

const router = express.Router();

const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const idOf = (v) => String(v?._id || v || '');
const userName = (u) => (u && typeof u === 'object'
  ? [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.email || ''
  : '');

/**
 * Document types with finance authority signatures.
 * pending: the status in which the authorities sign; approve/reject: the existing endpoints (under /api).
 */
const TYPES = [
  {
    type: 'bill_payment',
    label: 'Bill payment',
    model: ApPaymentApplication,
    pending: { workflowStatus: 'pending_authority' },
    populate: [
      { path: 'accountsPayableId', select: 'billNumber vendor' },
      { path: 'bills.billId', select: 'billNumber vendor' },
      { path: 'journalEntryId', select: 'entryNumber' }
    ],
    approve: (id) => `/finance/ap-payment-applications/${id}/finance-approve`,
    reject: (id) => `/finance/ap-payment-applications/${id}/finance-reject`,
    describe: (d) => ({
      // One bill (accountsPayableId) or several paid together (bills[])
      number: d.billNumber || d.accountsPayableId?.billNumber
        || (d.bills || []).map((b) => b.billNumber || b.billId?.billNumber).filter(Boolean).join(', '),
      party: d.accountsPayableId?.vendor?.name
        || [...new Set((d.bills || []).map((b) => b.billId?.vendor?.name).filter(Boolean))].join(', '),
      amount: d.amount,
      voucherId: idOf(d.journalEntryId),
      voucherNumber: d.journalEntryId?.entryNumber || ''
    })
  },
  {
    type: 'cash_approval',
    label: 'Cash approval',
    model: CashApproval,
    pending: { status: 'Pending Finance' },
    populate: [
      { path: 'vendor', select: 'name companyName' },
      { path: 'voucherEntryId', select: 'entryNumber' }
    ],
    approve: (id) => `/cash-approvals/${id}/finance-approve`,
    reject: (id) => `/cash-approvals/${id}/finance-reject`,
    describe: (d) => ({
      number: d.caNumber || '',
      party: d.vendor?.name || d.vendor?.companyName || '',
      amount: d.advanceAmount || d.totalAmount,
      detail: d.purpose || '',
      voucherId: idOf(d.voucherEntryId),
      voucherNumber: d.voucherEntryId?.entryNumber || d.advanceVoucherNo || '',
      openUrl: `/finance/payables-hub/document/cash-approval/${d._id}`
    })
  },
  {
    type: 'vendor_advance',
    label: 'Vendor advance',
    model: VendorAdvance,
    pending: { voucherWorkflowStatus: 'pending_authority' },
    populate: [{ path: 'journalEntryId', select: 'entryNumber' }],
    approve: (id) => `/finance/vendor-advances/${id}/finance-approve`,
    reject: (id) => `/finance/vendor-advances/${id}/finance-reject`,
    describe: (d) => ({
      number: d.journalEntryId?.entryNumber || d.reference || '',
      party: d.vendor?.name || '',
      amount: d.amount,
      detail: d.reference || '',
      voucherId: idOf(d.journalEntryId),
      voucherNumber: d.journalEntryId?.entryNumber || ''
    })
  },
  {
    type: 'payroll_payment',
    label: 'Payroll payment',
    model: PayrollPeriodPaymentApplication,
    pending: { workflowStatus: 'pending_authority' },
    populate: [{ path: 'journalEntryId', select: 'entryNumber' }],
    approve: (id) => `/finance/payroll-period-payments/${id}/finance-approve`,
    reject: (id) => `/finance/payroll-period-payments/${id}/finance-reject`,
    describe: (d) => ({
      number: d.periodLabel || `${MONTHS[d.month] || d.month} ${d.year}`,
      party: d.companyName || '',
      amount: d.amount,
      detail: d.employeeCount ? `${d.employeeCount} employees` : '',
      voucherId: idOf(d.journalEntryId),
      voucherNumber: d.journalEntryId?.entryNumber || ''
    })
  },
  {
    type: 'manual_salary_payment',
    label: 'Manual salary payment',
    model: ManualSalaryPaymentApplication,
    pending: { workflowStatus: 'pending_authority' },
    populate: [{ path: 'journalEntryId', select: 'entryNumber' }],
    approve: (id) => `/finance/manual-salary-payments/${id}/finance-approve`,
    reject: (id) => `/finance/manual-salary-payments/${id}/finance-reject`,
    describe: (d) => ({
      number: d.periodLabel || `${MONTHS[d.month] || d.month} ${d.year}`,
      party: d.companyName || '',
      amount: d.amount,
      detail: d.employeeCount ? `${d.employeeCount} employees` : '',
      voucherId: idOf(d.journalEntryId),
      voucherNumber: d.journalEntryId?.entryNumber || ''
    })
  },
  {
    type: 'journal_entry',
    label: 'Journal voucher',
    model: JournalEntry,
    // Only manual JVs carry their own authorities; other vouchers are signed through their source document
    pending: { status: 'draft', referenceType: 'manual' },
    populate: [],
    approve: (id) => `/finance/journal-entries/${id}/finance-approve`,
    reject: (id) => `/finance/journal-entries/${id}/finance-reject`,
    describe: (d) => ({
      number: d.entryNumber || '',
      party: '',
      amount: d.totalDebits,
      detail: d.description || '',
      voucherId: idOf(d._id),
      voucherNumber: d.entryNumber || ''
    })
  }
];

const approvedKeys = (doc) => new Set(
  (doc.financeAuthorityApprovals || [])
    .filter((a) => String(a?.decision || 'approved') !== 'rejected')
    .map((a) => String(a?.authorityKey || ''))
    .filter(Boolean)
);

/**
 * Pending items for one document type.
 * Normally only those still needing this user's signature; with `seeAll` (developer / super admin)
 * every pending document — the user can still only sign slots assigned to them (canAct).
 */
const itemsForType = async (cfg, userId, { seeAll = false } = {}) => {
  const assigned = FINANCE_AUTHORITY_SLOT_CONFIG.map((slot) => ({
    [`financeApprovalAuthorities.${slot.key}`]: new mongoose.Types.ObjectId(userId)
  }));
  // "All": every pending document; but a draft manual JV with no signers is just a draft, not an approval
  const anyAssigned = FINANCE_AUTHORITY_SLOT_CONFIG.map((slot) => ({
    [`financeApprovalAuthorities.${slot.key}`]: { $exists: true, $ne: null }
  }));
  let filter = { ...cfg.pending, $or: assigned };
  if (seeAll) filter = cfg.type === 'journal_entry' ? { ...cfg.pending, $or: anyAssigned } : { ...cfg.pending };
  let query = cfg.model.find(filter)
    .populate('financeAuthorityApprovals.approver', 'firstName lastName email')
    .populate('createdBy', 'firstName lastName email')
    .sort({ updatedAt: -1 });
  cfg.populate.forEach((p) => { query = query.populate(p); });
  const docs = await query.lean();

  // Names of the assigned signers (shown as "Waiting on …" for documents that aren't this user's)
  const signerNames = new Map();
  if (seeAll) {
    const ids = [...new Set(docs.flatMap((d) => FINANCE_AUTHORITY_SLOT_CONFIG
      .map((slot) => idOf(d.financeApprovalAuthorities?.[slot.key]))
      .filter((id) => mongoose.Types.ObjectId.isValid(id))))];
    if (ids.length) {
      const users = await mongoose.model('User').find({ _id: { $in: ids } }).select('firstName lastName email').lean();
      users.forEach((u) => signerNames.set(String(u._id), userName(u)));
    }
  }

  return docs.flatMap((doc) => {
    const authorities = doc.financeApprovalAuthorities || {};
    const done = approvedKeys(doc);
    const slots = FINANCE_AUTHORITY_SLOT_CONFIG.filter((slot) => authorities[slot.key]);
    const mine = slots.filter((slot) => idOf(authorities[slot.key]) === userId && !done.has(slot.key));
    if (!mine.length && !seeAll) return [];
    const waitingOn = slots
      .filter((slot) => !done.has(slot.key))
      .map((slot) => `${slot.label}: ${signerNames.get(idOf(authorities[slot.key])) || 'assigned user'}`);
    const id = String(doc._id);
    return [{
      type: cfg.type,
      typeLabel: cfg.label,
      id,
      ...cfg.describe(doc),
      date: doc.updatedAt || doc.createdAt,
      createdBy: userName(doc.createdBy),
      mySlots: mine.map((s) => s.label),
      canAct: mine.length > 0,
      waitingOn: slots.length ? waitingOn : ['finance authorities to be assigned'],
      signed: (doc.financeAuthorityApprovals || [])
        .filter((a) => String(a?.decision || 'approved') !== 'rejected')
        .map((a) => ({ label: a.authorityLabel, by: userName(a.approver), at: a.approvedAt })),
      signaturesRequired: slots.length,
      signaturesDone: slots.filter((s) => done.has(s.key)).length,
      approveUrl: cfg.approve(id),
      rejectUrl: cfg.reject(id)
    }];
  });
};

/**
 * HR lump-sum loan payments waiting for Finance to confirm receipt and post the RV.
 * No signature slots: any finance user can post. Posting needs the receive-in account / cost center,
 * so "approve" opens the receipt dialog (requiresForm) instead of a one-click approval.
 */
const FINANCE_ROLES = ['finance_manager', 'admin', 'super_admin', 'developer', 'higher_management'];
const isFinanceUser = (user) => {
  const roles = [user?.role, ...(Array.isArray(user?.roles) ? user.roles : [])].filter(Boolean);
  return roles.some((r) => FINANCE_ROLES.includes(String(r)));
};
const loanReceiptItems = async (user) => {
  if (!isFinanceUser(user)) return [];
  const LoanLumpSumRequest = require('../models/hr/LoanLumpSumRequest');
  require('../models/hr/Employee');
  const docs = await LoanLumpSumRequest.find({ status: 'Pending Finance' })
    .populate('employee', 'firstName lastName employeeId')
    .populate('requestedBy', 'firstName lastName email')
    .sort({ requestedAt: -1 })
    .lean();
  return docs.map((d) => {
    const id = String(d._id);
    const emp = d.employee || {};
    return {
      type: 'loan_receipt',
      typeLabel: 'Loan receipt',
      id,
      number: d.requestNumber,
      party: [emp.firstName, emp.lastName].filter(Boolean).join(' ') || emp.employeeId || '',
      detail: `${emp.employeeId ? `${emp.employeeId} · ` : ''}${d.paymentMethod}${d.reference ? ` · ${d.reference}` : ''}`,
      amount: d.amount,
      voucherId: '',
      voucherNumber: '',
      openUrl: `/finance/loan-receipts?open=${id}`,
      date: d.requestedAt || d.updatedAt,
      createdBy: userName(d.requestedBy),
      mySlots: ['Finance'],
      canAct: true,
      waitingOn: ['Finance'],
      signed: [],
      signaturesRequired: null,
      signaturesDone: null,
      requiresForm: true,
      approveUrl: null,
      rejectUrl: `/finance/loan-receipts/${id}/finance-reject`
    };
  });
};

// @route   GET /api/finance/my-approvals
// @desc    Documents waiting on the current user's finance authority signature
// @access  Private (any user; only documents where they are an assigned authority)
router.get('/', asyncHandler(async (req, res) => {
  const userId = idOf(req.user?._id || req.user?.id);
  if (!mongoose.Types.ObjectId.isValid(userId)) {
    return res.json({ success: true, data: { items: [], counts: {}, types: [] } });
  }
  // Developer and super admin see every pending approval (scope=mine narrows to their own)
  const roles = [req.user?.role, ...(Array.isArray(req.user?.roles) ? req.user.roles : [])].map(String);
  const canSeeAll = roles.includes('developer') || roles.includes('super_admin');
  const seeAll = canSeeAll && req.query.scope !== 'mine';

  const [results, loanReceipts] = await Promise.all([
    Promise.all(TYPES.map((cfg) => itemsForType(cfg, userId, { seeAll }))),
    loanReceiptItems(req.user).catch((e) => {
      console.error('my-approvals loan receipts:', e.message);
      return [];
    })
  ]);
  const items = [...results.flat(), ...loanReceipts].sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
  const counts = Object.fromEntries(TYPES.map((cfg, i) => [cfg.type, results[i].length]));
  counts.loan_receipt = loanReceipts.length;
  res.json({
    success: true,
    data: {
      items,
      counts,
      canSeeAll,
      scope: seeAll ? 'all' : 'mine',
      types: [...TYPES.map((cfg) => ({ type: cfg.type, label: cfg.label })), { type: 'loan_receipt', label: 'Loan receipt' }]
    }
  });
}));

module.exports = router;
