const mongoose = require('mongoose');

/**
 * Move a payable (vendor bill, cash approval, PO awaiting advance) to another company, so it shows under the right
 * company in the Payables hub and is paid from that company's books.
 *
 * Each company has its own chart of accounts, so a bill already posted to company A is moved by posting the same
 * entry in company B (each account matched by account number) and then reversing it in A — never by relabelling.
 * Anything with money already paid (payments, payment in approval, advance applied, paid cash approval, PO advance)
 * stays where it is: that cash left company A's bank.
 */

const KINDS = ['bill', 'cash-approval', 'po'];

const httpError = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const oid = (v) => (v && mongoose.Types.ObjectId.isValid(String(v)) ? new mongoose.Types.ObjectId(String(v)) : null);

const companyLabel = (c) => (c ? c.name : 'No company');

const loadDocument = async (kind, id) => {
  if (!KINDS.includes(kind)) throw httpError('Unknown document type');
  if (!oid(id)) throw httpError('Invalid document');
  const model = {
    bill: () => require('../models/finance/AccountsPayable'),
    'cash-approval': () => require('../models/procurement/CashApproval'),
    po: () => require('../models/procurement/PurchaseOrder')
  }[kind]();
  const doc = await model.findById(id).populate('companyId', 'name');
  if (!doc) throw httpError('Document not found', 404);
  return doc;
};

const documentNumber = (kind, doc) => (kind === 'bill' ? doc.billNumber : kind === 'cash-approval' ? doc.caNumber : doc.orderNumber);

/** Same account (by account number) and cost center (by code) in the target company */
const buildMappers = async (entries, targetId) => {
  const Account = require('../models/finance/Account');
  const CostCenter = require('../models/finance/CostCenter');
  const accountIds = new Set();
  const costCenterIds = new Set();
  entries.forEach((je) => (je.lines || []).forEach((l) => {
    if (l.account) accountIds.add(String(l.account._id || l.account));
    if (l.costCenter) costCenterIds.add(String(l.costCenter._id || l.costCenter));
  }));

  const sourceAccounts = await Account.find({ _id: { $in: [...accountIds] } }).select('accountNumber name').lean();
  const numbers = [...new Set(sourceAccounts.map((a) => a.accountNumber).filter(Boolean))];
  const targetAccounts = await Account.find({ companyId: targetId, accountNumber: { $in: numbers } }).select('_id accountNumber').lean();
  const targetByNumber = new Map(targetAccounts.map((a) => [a.accountNumber, a._id]));
  const accountMap = new Map();
  const missingAccounts = [];
  sourceAccounts.forEach((a) => {
    const target = targetByNumber.get(a.accountNumber);
    if (target) accountMap.set(String(a._id), target);
    else missingAccounts.push(`${a.accountNumber} ${a.name}`);
  });

  const sourceCcs = costCenterIds.size
    ? await CostCenter.find({ _id: { $in: [...costCenterIds] } }).select('code').lean()
    : [];
  const ccCodes = sourceCcs.map((c) => c.code).filter(Boolean);
  const targetCcs = ccCodes.length
    ? await CostCenter.find({ companyId: targetId, code: { $in: ccCodes } }).select('_id code').lean()
    : [];
  const ccByCode = new Map(targetCcs.map((c) => [c.code, c._id]));
  const costCenterMap = new Map(sourceCcs.map((c) => [String(c._id), ccByCode.get(c.code) || null]));

  return { accountMap, costCenterMap, missingAccounts };
};

/** Bill checks; returns the journal entries to move */
const checkBill = async (bill) => {
  const blockers = [];
  if (bill.status === 'cancelled') blockers.push('The bill is cancelled.');
  const paid = round2(bill.amountPaid) + round2(bill.advanceApplied);
  if (paid > 0.009 || (bill.payments || []).length) {
    blockers.push('Payments are already recorded against this bill in its current company — that money left its bank, so the bill stays there.');
  }
  if (round2(bill.paymentPending) > 0.009 || round2(bill.advancePending) > 0.009) {
    blockers.push('A payment for this bill is waiting for finance authority approval — finish or reject it first.');
  }
  const ApPaymentApplication = require('../models/finance/ApPaymentApplication');
  const inApproval = await ApPaymentApplication.countDocuments({
    workflowStatus: 'pending_authority',
    $or: [{ accountsPayableId: bill._id }, { 'bills.billId': bill._id }]
  });
  if (inApproval) blockers.push('A payment for this bill is waiting for finance authority approval — finish or reject it first.');

  // Bills from a PO / GRN follow the PO's company: its stock and GRNI entries are booked there
  if (['purchase_order', 'grn'].includes(bill.referenceType) && bill.referenceId) {
    const PurchaseOrder = require('../models/procurement/PurchaseOrder');
    const GoodsReceive = require('../models/procurement/GoodsReceive');
    let po = null;
    if (bill.referenceType === 'purchase_order') po = await PurchaseOrder.findById(bill.referenceId).select('orderNumber companyId').lean();
    else {
      const grn = await GoodsReceive.findById(bill.referenceId).select('purchaseOrder').lean();
      if (grn?.purchaseOrder) po = await PurchaseOrder.findById(grn.purchaseOrder).select('orderNumber companyId').lean();
    }
    if (po?.companyId) bill._sourcePo = po;
  }

  const JournalEntry = require('../models/finance/JournalEntry');
  const entries = await JournalEntry.find({
    referenceId: bill._id,
    referenceType: 'bill',
    status: { $in: ['posted', 'draft'] },
    isReversed: { $ne: true }
  }).lean();
  return { blockers: [...new Set(blockers)], entries };
};

const checkCashApproval = async (ca) => {
  const blockers = [];
  let entries = [];
  if (ca.voucherEntryId) {
    const JournalEntry = require('../models/finance/JournalEntry');
    const voucher = await JournalEntry.findById(ca.voucherEntryId).lean();
    if (voucher?.status === 'posted') {
      blockers.push(`The advance is already paid (voucher ${voucher.entryNumber || ''} posted) from its current company's bank, so it stays there.`);
    } else if (voucher && voucher.status === 'draft') {
      entries = [voucher];
    }
  }
  if (['Advance Issued', 'Evidence Submitted', 'Payment Settled'].includes(ca.status) && !blockers.length) {
    blockers.push(`The cash approval is already ${ca.status.toLowerCase()} — it stays in its current company.`);
  }
  return { blockers, entries };
};

const checkPo = async (po) => {
  const VendorAdvance = require('../models/finance/VendorAdvance');
  const { vendorAdvancesLinkedToPurchaseOrderFilter } = require('./fullAdvancePoGate');
  const advances = await VendorAdvance.countDocuments({
    ...vendorAdvancesLinkedToPurchaseOrderFilter(po._id),
    voucherWorkflowStatus: { $ne: 'rejected' }
  });
  const blockers = advances
    ? ['A vendor advance is already recorded against this PO in its current company — it stays there.']
    : [];
  return { blockers, entries: [] };
};

/**
 * What changing the company would do, or why it can't.
 * @returns {{ canChange, number, fromCompany, toCompany, blockers: string[], steps: string[], warnings: string[] }}
 */
const previewPayableCompanyChange = async (kind, id, targetCompanyId) => {
  const PlacementCompany = require('../models/hr/Company');
  const doc = await loadDocument(kind, id);
  const target = oid(targetCompanyId) ? await PlacementCompany.findById(targetCompanyId).select('name isActive').lean() : null;
  if (!target) throw httpError('Select the company to move it to');

  const from = doc.companyId && doc.companyId._id ? doc.companyId : null;
  const number = documentNumber(kind, doc);
  const result = {
    canChange: false,
    number,
    fromCompany: from ? { _id: from._id, name: from.name } : null,
    toCompany: { _id: target._id, name: target.name },
    blockers: [],
    steps: [],
    warnings: []
  };
  if (from && String(from._id) === String(target._id)) {
    result.blockers.push(`${number} is already in ${target.name}.`);
    return { ...result, doc };
  }

  const check = kind === 'bill' ? await checkBill(doc) : kind === 'cash-approval' ? await checkCashApproval(doc) : await checkPo(doc);
  result.blockers.push(...check.blockers);

  if (kind === 'bill' && doc._sourcePo && String(doc._sourcePo.companyId) !== String(target._id)) {
    result.blockers.push(`This bill comes from PO ${doc._sourcePo.orderNumber}, which is in another company — its stock and GRNI entries are booked there. Change the PO's company in Procurement first.`);
  }

  const posted = check.entries.filter((e) => e.status === 'posted');
  const drafts = check.entries.filter((e) => e.status === 'draft');
  const mappers = await buildMappers(check.entries, target._id);
  if (mappers.missingAccounts.length) {
    result.blockers.push(`${target.name} has no account with the same number for: ${mappers.missingAccounts.join(', ')}. Add these accounts to its chart of accounts first.`);
  }

  result.steps.push(`${number} will show under ${target.name} in Payables and be paid from ${target.name}'s banks.`);
  posted.forEach((e) => {
    result.steps.push(`Its entry ${e.entryNumber || ''} (${round2(e.totalDebits).toLocaleString()}) is posted again in ${target.name}'s books with the same accounts, and reversed in ${companyLabel(from)}'s books.`);
  });
  if (drafts.length) result.steps.push(`Its unposted voucher is moved to ${target.name}'s accounts.`);

  result.canChange = result.blockers.length === 0;
  result.blockers = [...new Set(result.blockers)];
  return { ...result, doc, posted, drafts, mappers };
};

/** Apply the change (re-checks everything first) */
const changePayableCompany = async (kind, id, targetCompanyId, { userId, reason = '' } = {}) => {
  const plan = await previewPayableCompanyChange(kind, id, targetCompanyId);
  if (!plan.canChange) throw httpError(plan.blockers.join(' '));
  const { doc, posted, drafts, mappers, toCompany, fromCompany } = plan;
  const FinanceHelper = require('./financeHelper');
  const JournalEntry = require('../models/finance/JournalEntry');
  const { withCompany } = require('./financePosting');
  const mapLine = (l) => ({
    account: mappers.accountMap.get(String(l.account?._id || l.account)),
    description: l.description,
    reference: l.reference,
    debit: l.debit,
    credit: l.credit,
    department: l.department,
    costCenter: l.costCenter ? mappers.costCenterMap.get(String(l.costCenter._id || l.costCenter)) || undefined : undefined,
    partyType: l.partyType,
    party: l.party
  });
  const note = `Moved from ${companyLabel(fromCompany)} to ${toCompany.name}${reason ? ` — ${reason}` : ''}`;

  // Posted entries: post in the new company first, then reverse in the old one (a failed post reverses nothing)
  for (const original of posted) {
    await FinanceHelper.createAndPostJournalEntry(withCompany({
      date: original.date,
      reference: original.reference,
      description: original.description,
      department: original.department,
      module: original.module,
      project: original.project,
      referenceId: original.referenceId,
      referenceType: original.referenceType,
      journal: original.journal,
      voucherSeries: original.voucherSeries,
      createdBy: userId,
      lines: original.lines.map(mapLine)
    }, toCompany._id));
    await FinanceHelper.reverseJournalEntry(original._id, { reason: `${original.entryNumber || ''} ${note}`.trim(), createdBy: userId });
  }
  // Draft vouchers are not in any ledger yet: switch their company and accounts in place
  for (const draft of drafts) {
    await JournalEntry.updateOne({ _id: draft._id }, {
      $set: { companyId: toCompany._id, lines: draft.lines.map((l) => ({ ...l, ...mapLine(l) })) }
    });
  }

  doc.companyId = toCompany._id;
  if (kind === 'bill') {
    const Account = require('../models/finance/Account');
    doc.company = toCompany.name;
    for (const li of doc.lineItems || []) {
      if (li.account) {
        const src = await Account.findById(li.account).select('accountNumber').lean();
        const tgt = src?.accountNumber ? await Account.findOne({ companyId: toCompany._id, accountNumber: src.accountNumber }).select('_id').lean() : null;
        if (tgt) li.account = tgt._id;
      }
      if (!li.company || li.company === fromCompany?.name) li.company = toCompany.name;
    }
    doc.observations = doc.observations || [];
    doc.observations.push({ observation: note, severity: 'low', addedBy: userId, resolved: true });
  } else {
    doc.workflowHistory = doc.workflowHistory || [];
    doc.workflowHistory.push({ fromStatus: doc.status, toStatus: doc.status, changedBy: userId, comments: note, module: 'Finance' });
  }
  doc.updatedBy = userId;
  await doc.save();

  return { number: plan.number, fromCompany, toCompany, movedEntries: posted.length + drafts.length };
};

module.exports = { previewPayableCompanyChange, changePayableCompany, KINDS };
