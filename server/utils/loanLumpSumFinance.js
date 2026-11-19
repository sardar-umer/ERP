/**
 * HR → Finance flow for lump-sum loan payments.
 *
 * HR submits a request (loan untouched). Finance confirms the money arrived and posts a
 * receipt voucher: Dr Cash/Bank, Cr Employee Loan (1125). Only then is the loan schedule
 * rebuilt (utils/loanLumpSumPayment). Reversing/deleting the voucher restores the loan.
 */
const mongoose = require('mongoose');
const Loan = require('../models/hr/Loan');
const LoanLumpSumRequest = require('../models/hr/LoanLumpSumRequest');
const FinanceHelper = require('./financeHelper');
const { acct, withCompany } = require('./financePosting');
const { resolveDocumentCompanyId } = require('./financeCompanyContext');
const { withVoucherNarration } = require('./documentNarration');

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const fmt = (n) => `Rs ${Math.round(Number(n) || 0).toLocaleString()}`;
const uid = (u) => (u && typeof u === 'object' ? (u._id || u.id) : u) || null;

class FlowError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

const SNAPSHOT_FIELDS = [
  'loanSchedule', 'monthlyInstallment', 'loanTerm', 'totalPaid', 'totalPrincipalPaid',
  'outstandingBalance', 'totalPayable', 'status', 'emiManuallyAdjusted'
];

const employeeName = (emp) =>
  [emp?.firstName, emp?.lastName].filter(Boolean).join(' ').trim() || emp?.employeeId || 'Employee';

const cleanInput = (body = {}) => ({
  amount: round2(body.amount),
  mode: body.mode === 'reduce_installment' ? 'reduce_installment' : 'reduce_tenure',
  paymentDate: body.paymentDate ? new Date(body.paymentDate) : new Date(),
  paymentMethod: body.paymentMethod || 'Cash',
  reference: body.reference ? String(body.reference).trim().slice(0, 100) : undefined,
  remarks: body.remarks ? String(body.remarks).trim().slice(0, 500) : undefined
});

// ── Notifications ─────────────────────────────────────────────────────────────

const notify = async ({ recipientIds, title, message, actionUrl, createdBy, request, type = 'info' }) => {
  try {
    const ids = [...new Set((recipientIds || []).filter(Boolean).map(String))];
    if (!ids.length) return;
    const { createAndEmitNotification } = require('../services/realtimeNotificationService');
    await createAndEmitNotification({
      recipientIds: ids,
      title,
      message,
      type,
      category: 'approval',
      priority: 'medium',
      actionUrl,
      createdBy,
      excludeUserId: createdBy,
      metadata: { module: 'loans', entityId: request._id, entityType: 'LoanLumpSumRequest', loanId: request.loan }
    });
  } catch (err) {
    console.error('Lump-sum notification failed:', err.message);
  }
};

const financeRecipientIds = async () => {
  const User = require('../models/User');
  const users = await User.find({
    isActive: true,
    role: { $in: ['finance_manager', 'admin', 'super_admin'] }
  }).select('_id').lean();
  return users.map((u) => u._id);
};

const notifyFinanceOfRequest = async (request, emp, actor, resubmitted = false) =>
  notify({
    recipientIds: await financeRecipientIds(),
    title: resubmitted ? 'Loan lump-sum resubmitted' : 'Loan lump-sum payment to confirm',
    message: `${request.requestNumber}: ${employeeName(emp)} (${emp?.employeeId || ''}) paid ${fmt(request.amount)} by ${request.paymentMethod}. Confirm receipt and post the voucher.`,
    actionUrl: '/finance/loan-receipts',
    createdBy: uid(actor),
    request
  });

const notifyHrOfDecision = async (request, emp, actor, decision) =>
  notify({
    recipientIds: [request.requestedBy],
    title: `Loan lump-sum ${decision.toLowerCase()}`,
    message: decision === 'Posted'
      ? `${request.requestNumber}: ${fmt(request.amount)} from ${employeeName(emp)} posted as ${request.voucherNumber}. Loan schedule updated.`
      : `${request.requestNumber}: ${fmt(request.amount)} from ${employeeName(emp)} was ${decision.toLowerCase()} by Finance.${request.financeComments ? ` ${request.financeComments}` : ''}`,
    actionUrl: `/hr/loans/${request.loan}`,
    createdBy: uid(actor),
    request,
    type: decision === 'Posted' ? 'success' : 'warning'
  });

// ── HR side ───────────────────────────────────────────────────────────────────

const assertNoOpenRequest = async (loanId, excludeId = null) => {
  const q = { loan: loanId, status: { $in: LoanLumpSumRequest.OPEN_STATUSES } };
  if (excludeId) q._id = { $ne: excludeId };
  const open = await LoanLumpSumRequest.findOne(q).select('requestNumber').lean();
  if (open) {
    throw new FlowError(`${open.requestNumber} is already pending with Finance for this loan. Wait for it, or cancel it first.`);
  }
};

/** Validate against the loan as it is now (throws LumpSumError with a readable message). */
const previewFor = (loan, input) => loan.applyLumpSumPayment(input, { dryRun: true });

const createRequest = async (loanId, body, user) => {
  const loan = await Loan.findById(loanId).populate('employee', 'firstName lastName employeeId');
  if (!loan) throw new FlowError('Loan not found', 404);
  await assertNoOpenRequest(loan._id);

  const input = cleanInput(body);
  const preview = previewFor(loan, input);

  const request = new LoanLumpSumRequest({
    ...input,
    loan: loan._id,
    employee: loan.employee._id,
    previewAtRequest: preview,
    requestedBy: uid(user),
    requestedAt: new Date(),
    history: [{ action: 'Submitted to Finance', by: uid(user) }]
  });
  await request.save();

  loan.notes.push({
    content: `${request.requestNumber}: lump sum of ${fmt(input.amount)} (${input.paymentMethod}${input.reference ? `, ref ${input.reference}` : ''}) sent to Finance for confirmation.`,
    addedBy: uid(user),
    addedAt: new Date()
  });
  await loan.save();

  await notifyFinanceOfRequest(request, loan.employee, user);
  return request;
};

const resubmitRequest = async (requestId, body, user) => {
  const request = await LoanLumpSumRequest.findById(requestId);
  if (!request) throw new FlowError('Request not found', 404);
  if (request.status !== 'Returned') throw new FlowError(`Only returned requests can be resubmitted (this one is ${request.status})`);

  const loan = await Loan.findById(request.loan).populate('employee', 'firstName lastName employeeId');
  if (!loan) throw new FlowError('Loan not found', 404);
  await assertNoOpenRequest(loan._id, request._id);

  const input = cleanInput(body);
  const preview = previewFor(loan, input);
  Object.assign(request, input, {
    previewAtRequest: preview,
    status: 'Pending Finance',
    requestedAt: new Date()
  });
  request.history.push({ action: 'Resubmitted to Finance', by: uid(user), comments: body.comments });
  await request.save();

  await notifyFinanceOfRequest(request, loan.employee, user, true);
  return request;
};

const cancelRequest = async (requestId, user, comments) => {
  const request = await LoanLumpSumRequest.findOneAndUpdate(
    { _id: requestId, status: { $in: ['Pending Finance', 'Returned'] } },
    {
      $set: { status: 'Cancelled' },
      $push: { history: { action: 'Cancelled by HR', by: uid(user), at: new Date(), comments } }
    },
    { new: true }
  );
  if (!request) throw new FlowError('Only pending or returned requests can be cancelled');
  return request;
};

const listRequestsForLoan = (loanId) =>
  LoanLumpSumRequest.find({ loan: loanId })
    .sort({ requestedAt: -1 })
    .populate('requestedBy', 'firstName lastName')
    .populate('processedBy', 'firstName lastName')
    .select('-loanSnapshot')
    .lean();

// ── Finance side ──────────────────────────────────────────────────────────────

/** List for Finance; `companyId` (from the Finance company selector) keeps only that company's employees. */
const listRequests = async ({ status, companyId = null } = {}) => {
  const q = {};
  if (status && status !== 'all') q.status = status;
  const rows = await LoanLumpSumRequest.find(q)
    .sort({ requestedAt: -1 })
    .limit(500)
    .populate('employee', 'firstName lastName employeeId placementCompany')
    .populate('loan', 'loanType loanAmount monthlyInstallment outstandingBalance status')
    .populate('requestedBy', 'firstName lastName')
    .populate('processedBy', 'firstName lastName')
    .select('-loanSnapshot')
    .lean();

  const companyByEmployee = new Map();
  for (const row of rows) {
    const empId = String(row.employee?._id || row.employee || '');
    if (!companyByEmployee.has(empId)) {
      const cid = row.companyId || await resolveDocumentCompanyId({ employeeId: empId }).catch(() => null);
      companyByEmployee.set(empId, cid ? String(cid) : null);
    }
    row.companyId = row.companyId ? String(row.companyId) : companyByEmployee.get(empId);
  }
  if (!companyId) return rows;
  return rows.filter((row) => !row.companyId || row.companyId === String(companyId));
};

/** Request + a fresh preview against the loan as it is right now + the employee's company. */
const getRequestForFinance = async (requestId) => {
  const request = await LoanLumpSumRequest.findById(requestId)
    .populate('employee', 'firstName lastName employeeId')
    .populate('requestedBy', 'firstName lastName')
    .populate('processedBy', 'firstName lastName')
    .select('-loanSnapshot')
    .lean();
  if (!request) throw new FlowError('Request not found', 404);

  const loan = await Loan.findById(request.loan);
  let currentPreview = null;
  let previewError = null;
  if (loan && LoanLumpSumRequest.OPEN_STATUSES.includes(request.status)) {
    try {
      currentPreview = previewFor(loan, request);
    } catch (e) {
      previewError = e.message;
    }
  }
  const companyId = await resolveDocumentCompanyId({ employeeId: request.employee?._id || request.employee });
  return {
    request,
    loan: loan ? {
      _id: loan._id,
      loanType: loan.loanType,
      loanAmount: loan.loanAmount,
      monthlyInstallment: loan.monthlyInstallment,
      outstandingBalance: loan.outstandingBalance,
      status: loan.status
    } : null,
    currentPreview,
    previewError,
    companyId: companyId ? String(companyId) : null
  };
};

const releaseLock = (id) =>
  LoanLumpSumRequest.updateOne({ _id: id, status: 'Posting' }, { $set: { status: 'Pending Finance' } });

/**
 * Finance confirms receipt: post RV (Dr Cash/Bank, Cr Employee Loan) and apply to the loan.
 * @param {{ bankAccountId?: string, date?: string, narration?: string, comments?: string }} body
 */
const postRequest = async (requestId, body, user) => {
  // Lock so two Finance users can't post the same request
  const request = await LoanLumpSumRequest.findOneAndUpdate(
    { _id: requestId, status: 'Pending Finance' },
    { $set: { status: 'Posting' } },
    { new: true }
  );
  if (!request) {
    const exists = await LoanLumpSumRequest.findById(requestId).select('status').lean();
    if (!exists) throw new FlowError('Request not found', 404);
    throw new FlowError(`This request is ${exists.status}; it can't be posted`);
  }

  let je = null;
  try {
    const loan = await Loan.findById(request.loan).populate('employee', 'firstName lastName employeeId');
    if (!loan) throw new FlowError('Loan not found', 404);
    const emp = loan.employee;

    // Finance may correct how/where the money came in before posting
    const METHODS = ['Cash', 'Bank Transfer', 'Cheque', 'Direct Payment'];
    if (body.paymentMethod && METHODS.includes(body.paymentMethod)) request.paymentMethod = body.paymentMethod;
    if (typeof body.reference === 'string') request.reference = body.reference.trim().slice(0, 100) || undefined;
    let costCenter = null;
    if (body.costCenter) {
      const FinanceCostCenter = require('../models/finance/CostCenter');
      const cc = await FinanceCostCenter.findById(body.costCenter).select('_id isActive').lean().catch(() => null);
      if (!cc) throw new FlowError('Selected cost center not found');
      costCenter = cc._id;
    }

    const snapshot = {};
    const plainLoan = loan.toObject({ depopulate: true });
    SNAPSHOT_FIELDS.forEach((f) => { snapshot[f] = plainLoan[f]; });

    // Apply in memory first — fails cleanly (nothing posted) if the loan changed and the amount no longer fits
    let result;
    try {
      result = loan.applyLumpSumPayment({
        amount: request.amount,
        mode: request.mode,
        paymentDate: request.paymentDate,
        paymentMethod: request.paymentMethod,
        reference: request.reference,
        remarks: request.remarks,
        userId: uid(user)
      });
    } catch (e) {
      throw new FlowError(`${e.message}. Return the request to HR to correct it.`);
    }

    const companyId = await resolveDocumentCompanyId({ employeeId: emp._id });
    const A = acct(companyId);
    const loanAccount = await A.resolve(FinanceHelper.ACCOUNTS.EMPLOYEE_LOAN);
    if (!loanAccount) {
      throw new FlowError('Employee Loan account (1125) not found in this company\'s chart of accounts');
    }
    const fallback = request.paymentMethod === 'Cash' ? FinanceHelper.ACCOUNTS.CASH : FinanceHelper.ACCOUNTS.BANK;
    const receivedIn = await A.bank(body.bankAccountId, body.bankAccountId ? null : fallback);
    if (!receivedIn) throw new FlowError('Select the cash / bank account the money was received in');
    if (String(receivedIn.type || '').toLowerCase() !== 'asset') {
      throw new FlowError('Received-in account must be a cash or bank (asset) account');
    }

    const amount = round2(result.amount);
    const name = employeeName(emp);
    const narration = String(body.narration || '').trim()
      || `Employee Loan — lump sum recovery from ${name} (${emp.employeeId || ''}), ${request.requestNumber}`
        + `${request.reference ? `, ref ${request.reference}` : ''}`;
    const party = { partyType: 'Employee', party: emp._id };

    je = await FinanceHelper.createAndPostJournalEntry(withVoucherNarration(withCompany({
      date: body.date ? new Date(body.date) : request.paymentDate,
      reference: [request.requestNumber, request.reference].filter(Boolean).join(' / ').slice(0, 100),
      description: narration,
      department: 'hr',
      module: 'hr',
      costCenter,
      referenceId: request._id,
      referenceType: 'receipt',
      journalCode: 'BANK',
      voucherSeries: 'RV',
      createdBy: uid(user),
      lines: [
        { account: receivedIn._id, description: narration, debit: amount, credit: 0, department: 'hr', costCenter: costCenter || undefined, ...party },
        { account: loanAccount._id, description: narration, debit: 0, credit: amount, department: 'hr', costCenter: costCenter || undefined, ...party }
      ]
    }, companyId), narration));

    // Link the voucher on the loan's payment entry
    const payment = loan.payments[loan.payments.length - 1];
    payment.lumpSumRequest = request._id;
    payment.requestNumber = request.requestNumber;
    payment.journalEntry = je._id;
    payment.voucherNumber = je.entryNumber;
    loan.updatedBy = uid(user);

    try {
      await loan.save();
    } catch (saveErr) {
      // Keep books and loan in step: undo the voucher if the loan couldn't be updated
      await FinanceHelper.reverseJournalEntry(je, {
        reason: `Auto-reversal: loan update failed for ${request.requestNumber}`,
        createdBy: uid(user)
      }).catch((e) => console.error('Lump-sum auto-reversal failed:', e.message));
      throw saveErr;
    }

    request.status = 'Posted';
    request.processedBy = uid(user);
    request.processedAt = new Date();
    request.financeComments = body.comments ? String(body.comments).trim().slice(0, 500) : request.financeComments;
    request.companyId = companyId || undefined;
    request.receivedInAccount = receivedIn._id;
    request.journalEntry = je._id;
    request.voucherNumber = je.entryNumber;
    request.loanPaymentId = payment._id;
    request.postingResult = result;
    request.loanSnapshot = snapshot;
    request.history.push({ action: `Posted ${je.entryNumber}`, by: uid(user), comments: body.comments });
    await request.save();

    await notifyHrOfDecision(request, emp, user, 'Posted');
    return { request, result, voucherNumber: je.entryNumber };
  } catch (err) {
    await releaseLock(request._id);
    throw err;
  }
};

const decideRequest = async (requestId, decision, comments, user) => {
  if (!String(comments || '').trim()) throw new FlowError('Please add a comment for HR');
  const request = await LoanLumpSumRequest.findOneAndUpdate(
    { _id: requestId, status: 'Pending Finance' },
    {
      $set: {
        status: decision,
        financeComments: String(comments).trim().slice(0, 500),
        processedBy: uid(user),
        processedAt: new Date()
      },
      $push: { history: { action: `${decision} by Finance`, by: uid(user), at: new Date(), comments } }
    },
    { new: true }
  );
  if (!request) throw new FlowError('Only requests pending with Finance can be returned or rejected');
  const emp = await mongoose.model('Employee').findById(request.employee).select('firstName lastName employeeId').lean();
  await notifyHrOfDecision(request, emp, user, decision);
  return request;
};

// ── Voucher reversal / deletion ───────────────────────────────────────────────

/**
 * Restore the loan when a lump-sum voucher is reversed or deleted.
 * Only safe if nothing happened on the loan after this payment; otherwise throws (blocks the action).
 * @returns {Promise<boolean>} true when a lump sum was undone
 */
const undoLumpSumForJournalEntry = async (entryId, { userId, note, checkOnly = false } = {}) => {
  const request = await LoanLumpSumRequest.findOne({ journalEntry: entryId, status: 'Posted' });
  if (!request) return false;

  const loan = await Loan.findById(request.loan);
  if (!loan) throw new FlowError(`Loan for ${request.requestNumber} not found — cannot undo the lump sum`);

  const snap = request.loanSnapshot || {};
  const lastPayment = loan.payments[loan.payments.length - 1];
  const untouched =
    lastPayment && String(lastPayment._id) === String(request.loanPaymentId) &&
    Math.abs(round2(loan.totalPaid) - round2((Number(snap.totalPaid) || 0) + Number(request.amount))) < 1;
  if (!untouched) {
    throw new FlowError(
      `${request.requestNumber} can't be undone automatically: the loan has had payments or changes since this lump sum was posted. ` +
      'Adjust the loan manually first, or contact the developer.'
    );
  }

  if (checkOnly) return true;

  // Direct update: Loan pre-save would re-derive EMI/totals from loanTerm when restoring
  const restore = {};
  SNAPSHOT_FIELDS.forEach((f) => { restore[f] = snap[f]; });
  await Loan.updateOne(
    { _id: loan._id },
    {
      $set: { ...restore, updatedBy: userId || loan.updatedBy },
      $pull: { payments: { _id: request.loanPaymentId } }
    }
  );
  await Loan.updateOne(
    { _id: loan._id },
    {
      $push: {
        notes: {
          content: `${request.requestNumber}: lump sum of ${fmt(request.amount)} undone — voucher ${request.voucherNumber} ${note || 'reversed'} in Finance. Schedule restored.`,
          addedBy: userId || request.processedBy,
          addedAt: new Date()
        }
      }
    }
  );

  request.status = 'Reversed';
  request.reversedAt = new Date();
  request.reversedBy = userId || undefined;
  request.reversalNote = note;
  request.history.push({ action: `Voucher ${note || 'reversed'} — loan restored`, by: userId });
  await request.save();
  return true;
};

module.exports = {
  FlowError,
  createRequest,
  resubmitRequest,
  cancelRequest,
  listRequestsForLoan,
  listRequests,
  getRequestForFinance,
  postRequest,
  decideRequest,
  undoLumpSumForJournalEntry
};
