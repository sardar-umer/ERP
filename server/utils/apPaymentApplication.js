const mongoose = require('mongoose');
const Account = require('../models/finance/Account');
const JournalEntry = require('../models/finance/JournalEntry');
const GeneralLedger = require('../models/finance/GeneralLedger');
const AccountsPayable = require('../models/finance/AccountsPayable');
const VendorAdvance = require('../models/finance/VendorAdvance');
const CashApproval = require('../models/procurement/CashApproval');
const Employee = require('../models/hr/Employee');
const ApPaymentApplication = require('../models/finance/ApPaymentApplication');
const FinanceHelper = require('./financeHelper');
const { syncLinkedUtilityBillsFromApPayment } = require('./utilityBillFinance');
const { syncIpcFromApPayment } = require('./projectIpcFinance');
const {
  getRequiredFinanceAuthoritySlots,
  matchUserToFinanceSlots
} = require('./financeAuthoritySlots');

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const sumPendingAmount = async (filter) => {
  const rows = await ApPaymentApplication.aggregate([
    { $match: { ...filter, workflowStatus: 'pending_authority' } },
    { $group: { _id: null, total: { $sum: '$amount' } } }
  ]);
  return round2(rows[0]?.total || 0);
};

const sumPendingForBill = (billId) =>
  sumPendingAmount({ accountsPayableId: new mongoose.Types.ObjectId(String(billId)) });

const sumPendingForCashApproval = (cashApprovalId) =>
  sumPendingAmount({ cashApprovalId: new mongoose.Types.ObjectId(String(cashApprovalId)) });

const sumPendingForVendorAdvance = (vendorAdvanceId) =>
  sumPendingAmount({ vendorAdvanceId: new mongoose.Types.ObjectId(String(vendorAdvanceId)) });

const resolvePaymentFinanceAuthorities = async (bill, explicit, createdBy) => {
  try {
    return resolveFinanceAuthorities({ explicit, sourceDoc: null, createdBy });
  } catch (_first) {
    /* try linked documents */
  }
  if (bill.payeeEmployee) {
    const ca = await CashApproval.findOne({
      advanceToEmployee: bill.payeeEmployee,
      advanceIssuedAt: { $ne: null },
      'financeApprovalAuthorities.accountsManagerUser': { $ne: null },
      'financeApprovalAuthorities.financeControllerUser': { $ne: null }
    })
      .sort({ advanceIssuedAt: -1 })
      .lean();
    if (ca) return resolveFinanceAuthorities({ sourceDoc: ca, createdBy });
  }
  if (bill.vendor?.vendorId) {
    const adv = await VendorAdvance.findOne({
      'vendor.vendorId': bill.vendor.vendorId,
      voucherWorkflowStatus: { $in: ['fully_approved', 'immediate'] },
      'financeApprovalAuthorities.accountsManagerUser': { $ne: null },
      'financeApprovalAuthorities.financeControllerUser': { $ne: null }
    })
      .sort({ paymentDate: -1 })
      .lean();
    if (adv) return resolveFinanceAuthorities({ sourceDoc: adv, createdBy });
  }
  throw new Error(
    'Sr Manager Accounts and GM Finance approvers are required. Send financeApprovalAuthorities, or configure authorities on a related cash approval / vendor advance.'
  );
};

const resolveFinanceAuthorities = ({ explicit, sourceDoc, createdBy }) => {
  const raw = explicit && typeof explicit === 'object' ? explicit : null;
  const fromSource = sourceDoc?.financeApprovalAuthorities || {};
  const am = raw?.accountsManagerUser || raw?.accountsManager || fromSource.accountsManagerUser;
  const fc = raw?.financeControllerUser || raw?.financeController || fromSource.financeControllerUser;
  if (!am || !fc) {
    throw new Error(
      'Sr Manager Accounts and GM Finance approvers are required. Configure finance authorities on the cash approval / vendor advance, or send financeApprovalAuthorities in the request.'
    );
  }
  if (!mongoose.Types.ObjectId.isValid(String(am)) || !mongoose.Types.ObjectId.isValid(String(fc))) {
    throw new Error('Invalid finance approval authority user ids');
  }
  return {
    accountsOfficerUser: createdBy,
    accountsManagerUser: am,
    financeControllerUser: fc
  };
};

const preparerApproval = (createdBy) => ({
  authorityKey: 'accountsOfficerUser',
  authorityLabel: 'Accounts Officer / AM',
  approver: createdBy,
  decision: 'approved',
  approvedAt: new Date(),
  comments: 'Preparer — submitted AP settlement'
});

const addBillPending = async (bill, amount, sourceType) => {
  if (sourceType === 'bank_payment') {
    bill.paymentPending = round2((Number(bill.paymentPending) || 0) + amount);
  } else {
    bill.advancePending = round2((Number(bill.advancePending) || 0) + amount);
  }
  await bill.save();
};

const releaseBillPending = async (bill, amount, sourceType) => {
  if (sourceType === 'bank_payment') {
    bill.paymentPending = round2(Math.max(0, (Number(bill.paymentPending) || 0) - amount));
  } else {
    bill.advancePending = round2(Math.max(0, (Number(bill.advancePending) || 0) - amount));
  }
  await bill.save();
};

const postDraftJournal = async (je, userId) => {
  if (!je) throw new Error('Linked journal entry missing');
  if (je.status === 'draft') {
    await je.post(userId);
    const glCount = await GeneralLedger.countDocuments({ journalEntry: je._id });
    if (glCount === 0) {
      await FinanceHelper.postToGeneralLedger(je._id);
    }
  } else if (je.status !== 'posted') {
    throw new Error(`Journal entry cannot be finalized from status: ${je.status}`);
  }
};

const finalizeApplication = async (app, userId) => {
  const billsToProcess = app.bills?.length > 0 
    ? app.bills 
    : [{ billId: app.accountsPayableId, amount: app.amount }];

  const je = await JournalEntry.findById(app.journalEntryId);
  await postDraftJournal(je, userId);

  if (app.payingJournalEntryId) {
    const payingJe = await JournalEntry.findById(app.payingJournalEntryId);
    await postDraftJournal(payingJe, userId);
  }

  const meta = app.paymentMeta || {};
  const normalizedAllocations = Array.isArray(meta.allocations)
    ? meta.allocations
      .map((a) => ({
        grnId: a?.grnId || null,
        amount: round2(a?.amount)
      }))
      .filter((a) => a.grnId && a.amount > 0)
    : [];

  for (const item of billsToProcess) {
    const bill = await AccountsPayable.findById(item.billId);
    if (!bill) continue;

    const amount = round2(item.amount);

    if (app.sourceType === 'cash_approval') {
      const ca = await CashApproval.findById(app.cashApprovalId);
      if (!ca) throw new Error('Cash approval not found');
      const employee = bill.payeeEmployee ? await Employee.findById(bill.payeeEmployee) : null;
      if (!employee) throw new Error('Employee payee missing on bill');

      ca.apAdvanceApplied = round2((Number(ca.apAdvanceApplied) || 0) + amount);
      await ca.save();

      bill.advanceApplied = round2((Number(bill.advanceApplied) || 0) + amount);
      if (!Array.isArray(bill.employeeAdvanceAllocations)) bill.employeeAdvanceAllocations = [];
      bill.employeeAdvanceAllocations.push({
        cashApprovalId: ca._id,
        caNumber: ca.caNumber,
        amount,
        appliedAt: new Date()
      });
    } else if (app.sourceType === 'vendor_advance') {
      const adv = await VendorAdvance.findById(app.vendorAdvanceId);
      if (!adv) throw new Error('Vendor advance not found');

      bill.advanceApplied = round2((Number(bill.advanceApplied) || 0) + amount);
      adv.appliedAmount = round2((Number(adv.appliedAmount) || 0) + amount);
      const newRem = round2((Number(adv.amount) || 0) - (Number(adv.appliedAmount) || 0));
      adv.status = newRem <= 0.01 ? 'applied' : 'partially_applied';
      if (!Array.isArray(adv.allocations)) adv.allocations = [];
      adv.allocations.push({
        billId: bill._id,
        billNumber: bill.billNumber,
        amount,
        appliedAt: new Date()
      });
      await adv.save();
    } else if (app.sourceType === 'bank_payment') {
      bill.payments.push({
        amount,
        paymentDate: je?.date || new Date(),
        paymentMethod: meta.paymentMethod || 'bank_transfer',
        reference: meta.reference || '',
        batchId: meta.batchId || null,
        createdBy: app.createdBy,
        allocations: normalizedAllocations
      });
      bill.amountPaid = round2((Number(bill.amountPaid) || 0) + amount);
      if (bill.isAdvanceBill) {
        await FinanceHelper.createAdvanceFromAdvanceBillPayment({ bill, amount, journalEntry: je, meta, createdBy: app.createdBy });
      }
    }

    await releaseBillPending(bill, amount, app.sourceType);
    FinanceHelper._updateDocumentStatus(bill);
    await bill.save();

    try {
      await syncLinkedUtilityBillsFromApPayment(bill, userId);
    } catch (syncErr) {
      console.error('[apPaymentApplication] Admin utility bill sync failed:', syncErr.message);
    }
    try {
      await syncIpcFromApPayment(bill);
    } catch (syncErr) {
      console.error('[apPaymentApplication] Project IPC sync failed:', syncErr.message);
    }
  }

  app.workflowStatus = 'fully_approved';
  app.finalizedAt = new Date();
  await app.save();

  return { app, journalEntry: je };
};

const rejectApplication = async (app, user, comments) => {
  const billsToProcess = app.bills?.length > 0 
    ? app.bills 
    : [{ billId: app.accountsPayableId, amount: app.amount }];

  for (const item of billsToProcess) {
    const bill = await AccountsPayable.findById(item.billId);
    if (bill) {
      await releaseBillPending(bill, round2(item.amount), app.sourceType);
    }
  }

  app.workflowStatus = 'rejected';
  await app.save();

  const je = app.journalEntryId ? await JournalEntry.findById(app.journalEntryId) : null;
  if (je && je.status === 'draft') {
    je.status = 'cancelled';
    await je.save();
  }

  if (app.payingJournalEntryId) {
    const payingJe = await JournalEntry.findById(app.payingJournalEntryId);
    if (payingJe && payingJe.status === 'draft') {
      payingJe.status = 'cancelled';
      await payingJe.save();
    }
  }

  return app;
};

const recordAuthorityApproval = async (app, user, comments = '') => {
  if (app.workflowStatus !== 'pending_authority') {
    throw new Error('Finance approval only applies while settlement is pending signatures');
  }
  const slots = getRequiredFinanceAuthoritySlots(app);
  if (!slots.length) {
    throw new Error('Finance approval authorities are not configured on this settlement');
  }
  const matchedSlots = matchUserToFinanceSlots(slots, user);
  if (!matchedSlots.length) {
    throw new Error('Your user is not assigned as a finance authority for this voucher');
  }

  const approvals = Array.isArray(app.financeAuthorityApprovals) ? [...app.financeAuthorityApprovals] : [];
  const approvedKeys = new Set(
    approvals
      .filter((a) => String(a?.decision || 'approved').trim() !== 'rejected')
      .map((a) => String(a?.authorityKey || '').trim())
      .filter(Boolean)
  );
  const pendingMatchedSlots = matchedSlots.filter((slot) => !approvedKeys.has(slot.key));
  if (!pendingMatchedSlots.length) {
    throw new Error('You have already approved your assigned finance authority slot');
  }

  const now = new Date();
  pendingMatchedSlots.forEach((slot) => {
    approvals.push({
      authorityKey: slot.key,
      authorityLabel: slot.label,
      approver: user._id || user.id,
      decision: 'approved',
      approvedAt: now,
      comments
    });
  });
  app.financeAuthorityApprovals = approvals;
  await app.save();

  const requiredKeys = new Set(slots.map((s) => s.key));
  const approvedNow = new Set(
    app.financeAuthorityApprovals
      .filter((a) => String(a?.decision || 'approved').trim() !== 'rejected')
      .map((a) => String(a?.authorityKey || '').trim())
      .filter(Boolean)
  );
  const remaining = [...requiredKeys].filter((k) => !approvedNow.has(k)).length;

  if (remaining === 0) {
    await finalizeApplication(app, user._id || user.id);
  }

  return { remaining, finalized: remaining === 0 };
};

const recordAuthorityRejection = async (app, user, comments = '') => {
  if (app.workflowStatus !== 'pending_authority') {
    throw new Error('Rejection only applies while settlement is pending signatures');
  }
  const slots = getRequiredFinanceAuthoritySlots(app);
  if (!slots.length) {
    throw new Error('Finance approval authorities are not configured on this settlement');
  }
  const matchedSlots = matchUserToFinanceSlots(slots, user);
  if (!matchedSlots.length) {
    throw new Error('Your user is not assigned as a finance authority for this voucher');
  }

  const approvals = Array.isArray(app.financeAuthorityApprovals) ? [...app.financeAuthorityApprovals] : [];
  const decidedKeys = new Set(approvals.map((a) => String(a?.authorityKey || '').trim()).filter(Boolean));
  const pendingMatchedSlots = matchedSlots.filter((slot) => !decidedKeys.has(slot.key));
  if (!pendingMatchedSlots.length) {
    throw new Error('You have already acted on your assigned finance authority slot');
  }

  const now = new Date();
  pendingMatchedSlots.forEach((slot) => {
    approvals.push({
      authorityKey: slot.key,
      authorityLabel: slot.label,
      approver: user._id || user.id,
      decision: 'rejected',
      approvedAt: now,
      comments
    });
  });
  app.financeAuthorityApprovals = approvals;
  await rejectApplication(app, user, comments);
  return app;
};

/**
 * Create draft settlement voucher + pending application (bill not marked paid until approved).
 */
const submitSettlement = async ({
  bill,
  amount,
  sourceType,
  createdBy,
  financeApprovalAuthorities,
  authoritySourceDoc,
  journalPayload,
  vendorAdvanceId = null,
  cashApprovalId = null,
  paymentMeta = null
}) => {
  const amount_ = round2(amount);
  if (amount_ <= 0) throw new Error('Settlement amount must be greater than zero');

  const outstanding = FinanceHelper.getAPOutstanding(bill);
  if (amount_ > outstanding + 0.009) {
    throw new Error(`Amount PKR ${amount_} exceeds outstanding balance PKR ${outstanding}`);
  }

  if (sourceType === 'cash_approval' && cashApprovalId) {
    const ca = await CashApproval.findById(cashApprovalId);
    if (!ca) throw new Error('Cash approval not found');
    const caOpen = await getCaOpenForAp(ca);
    if (amount_ > caOpen + 0.009) {
      throw new Error(`Amount exceeds open balance on ${ca.caNumber} (open: ${caOpen})`);
    }
    authoritySourceDoc = authoritySourceDoc || ca;
  }

  if (sourceType === 'vendor_advance' && vendorAdvanceId) {
    const adv = await VendorAdvance.findById(vendorAdvanceId);
    if (!adv) throw new Error('Vendor advance not found');
    const wf = adv.voucherWorkflowStatus || 'immediate';
    if (wf === 'pending_authority' || wf === 'rejected') {
      throw new Error('Vendor advance voucher is not fully approved yet');
    }
    const advRemaining = round2((Number(adv.amount) || 0) - (Number(adv.appliedAmount) || 0));
    const pendingOnAdv = await sumPendingForVendorAdvance(adv._id);
    const openAdv = round2(Math.max(0, advRemaining - pendingOnAdv));
    if (amount_ > openAdv + 0.009) {
      throw new Error(`Amount exceeds open vendor advance balance (${openAdv})`);
    }
    authoritySourceDoc = authoritySourceDoc || adv;
  }

  const hasExplicit =
    financeApprovalAuthorities
    && (financeApprovalAuthorities.accountsManagerUser || financeApprovalAuthorities.accountsManager)
    && (financeApprovalAuthorities.financeControllerUser || financeApprovalAuthorities.financeController);
  const authorities = hasExplicit
    ? resolveFinanceAuthorities({ explicit: financeApprovalAuthorities, createdBy })
    : resolveFinanceAuthorities({ explicit: null, sourceDoc: authoritySourceDoc, createdBy });

  const journalEntry = await FinanceHelper.createDraftJournalEntry({
    ...journalPayload,
    date: journalPayload.date || new Date(),
    referenceId: bill._id,
    createdBy
  });

  const app = await ApPaymentApplication.create({
    accountsPayableId: bill._id,
    billNumber: bill.billNumber,
    amount: amount_,
    sourceType,
    vendorAdvanceId: vendorAdvanceId || null,
    cashApprovalId: cashApprovalId || null,
    paymentMeta: paymentMeta || undefined,
    journalEntryId: journalEntry._id,
    workflowStatus: 'pending_authority',
    financeApprovalAuthorities: authorities,
    financeAuthorityApprovals: [preparerApproval(createdBy)],
    createdBy
  });

  await addBillPending(bill, amount_, sourceType);

  return { application: app, journalEntry, pendingAmount: amount_ };
};

const submitBatchSettlement = async ({
  bills, // array of { bill: Document, amount: Number }
  sourceType,
  createdBy,
  financeApprovalAuthorities,
  authoritySourceDoc,
  journalPayload,
  payingJournalPayload = null,
  vendorAdvanceId = null,
  cashApprovalId = null,
  paymentMeta = null
}) => {
  let totalAmount = 0;
  const billObjects = [];

  for (const item of bills) {
    const amount_ = round2(item.amount);
    if (amount_ <= 0) throw new Error('Settlement amount must be greater than zero');
    
    const outstanding = FinanceHelper.getAPOutstanding(item.bill);
    if (amount_ > outstanding + 0.009) {
      throw new Error(`Amount PKR ${amount_} exceeds outstanding balance PKR ${outstanding} for bill ${item.bill.billNumber}`);
    }
    
    totalAmount += amount_;
    billObjects.push({
      billId: item.bill._id,
      billNumber: item.bill.billNumber,
      amount: amount_
    });
  }

  totalAmount = round2(totalAmount);

  // We only support bank_payment natively for batch but let's be safe
  if (sourceType === 'cash_approval' && cashApprovalId) {
    const ca = await CashApproval.findById(cashApprovalId);
    if (!ca) throw new Error('Cash approval not found');
    const caOpen = await getCaOpenForAp(ca);
    if (totalAmount > caOpen + 0.009) {
      throw new Error(`Total amount exceeds open balance on ${ca.caNumber} (open: ${caOpen})`);
    }
    authoritySourceDoc = authoritySourceDoc || ca;
  }

  if (sourceType === 'vendor_advance' && vendorAdvanceId) {
    const adv = await VendorAdvance.findById(vendorAdvanceId);
    if (!adv) throw new Error('Vendor advance not found');
    const wf = adv.voucherWorkflowStatus || 'immediate';
    if (wf === 'pending_authority' || wf === 'rejected') {
      throw new Error('Vendor advance voucher is not fully approved yet');
    }
    const advRemaining = round2((Number(adv.amount) || 0) - (Number(adv.appliedAmount) || 0));
    const pendingOnAdv = await sumPendingForVendorAdvance(adv._id);
    const openAdv = round2(Math.max(0, advRemaining - pendingOnAdv));
    if (totalAmount > openAdv + 0.009) {
      throw new Error(`Total amount exceeds open vendor advance balance (${openAdv})`);
    }
    authoritySourceDoc = authoritySourceDoc || adv;
  }

  const hasExplicit =
    financeApprovalAuthorities
    && (financeApprovalAuthorities.accountsManagerUser || financeApprovalAuthorities.accountsManager)
    && (financeApprovalAuthorities.financeControllerUser || financeApprovalAuthorities.financeController);
  const authorities = hasExplicit
    ? resolveFinanceAuthorities({ explicit: financeApprovalAuthorities, createdBy })
    : resolveFinanceAuthorities({ explicit: null, sourceDoc: authoritySourceDoc, createdBy });

  const journalEntry = await FinanceHelper.createDraftJournalEntry({
    ...journalPayload,
    date: journalPayload.date || new Date(),
    referenceId: bills[0].bill._id, // arbitrarily linking to first bill
    createdBy
  });

  // Pin original/bill voucher to its companyId; clear payingCompanyId so it does not
  // appear twice under the paying-company voucher filter (voucherCompanyQuery matches both).
  const expectedBillCo = journalPayload.companyId;
  if (expectedBillCo) {
    let dirty = false;
    if (!journalEntry.companyId || String(journalEntry.companyId) !== String(expectedBillCo)) {
      journalEntry.companyId = expectedBillCo;
      dirty = true;
    }
    if (journalEntry.payingCompanyId) {
      journalEntry.payingCompanyId = undefined;
      dirty = true;
    }
    if (dirty) await journalEntry.save();
  }

  let payingJournalEntry = null;
  if (payingJournalPayload) {
    payingJournalEntry = await FinanceHelper.createDraftJournalEntry({
      ...payingJournalPayload,
      date: payingJournalPayload.date || journalPayload.date || new Date(),
      referenceId: bills[0].bill._id,
      createdBy,
      payingCompanyId: undefined
    });
    const expectedPayingCo = payingJournalPayload.companyId;
    if (
      expectedPayingCo
      && (!payingJournalEntry.companyId || String(payingJournalEntry.companyId) !== String(expectedPayingCo))
    ) {
      payingJournalEntry.companyId = expectedPayingCo;
      await payingJournalEntry.save();
    }
  }

  const app = await ApPaymentApplication.create({
    bills: billObjects,
    amount: totalAmount,
    sourceType,
    vendorAdvanceId: vendorAdvanceId || null,
    cashApprovalId: cashApprovalId || null,
    paymentMeta: paymentMeta || undefined,
    journalEntryId: journalEntry._id,
    payingJournalEntryId: payingJournalEntry ? payingJournalEntry._id : null,
    workflowStatus: 'pending_authority',
    financeApprovalAuthorities: authorities,
    financeAuthorityApprovals: [preparerApproval(createdBy)],
    createdBy
  });

  for (const item of bills) {
    await addBillPending(item.bill, round2(item.amount), sourceType);
  }

  return {
    application: app,
    journalEntry,
    payingJournalEntry,
    pendingAmount: totalAmount
  };
};

const getCaOpenForAp = async (ca) => {
  const advanced = round2(Number(ca.advanceAmount) || Number(ca.totalAmount) || 0);
  const alreadyToAp = round2(Number(ca.apAdvanceApplied) || 0);
  const pendingReserve = await sumPendingForCashApproval(ca._id);
  return Math.max(0, round2(advanced - alreadyToAp - pendingReserve));
};

const populateApplication = (query) =>
  ApPaymentApplication.findOne(query)
    .populate('financeApprovalAuthorities.accountsOfficerUser', 'firstName lastName email employeeId digitalSignature')
    .populate('financeApprovalAuthorities.accountsManagerUser', 'firstName lastName email employeeId digitalSignature')
    .populate('financeApprovalAuthorities.financeControllerUser', 'firstName lastName email employeeId digitalSignature')
    .populate('financeAuthorityApprovals.approver', 'firstName lastName email employeeId digitalSignature')
    .populate('accountsPayableId', 'billNumber vendor totalAmount status')
    .populate('bills.billId', 'billNumber vendor totalAmount status');

module.exports = {
  round2,
  sumPendingForBill,
  sumPendingForCashApproval,
  sumPendingForVendorAdvance,
  getCaOpenForAp,
  submitSettlement,
  submitBatchSettlement,
  finalizeApplication,
  rejectApplication,
  recordAuthorityApproval,
  recordAuthorityRejection,
  populateApplication,
  resolveFinanceAuthorities,
  resolvePaymentFinanceAuthorities
};
