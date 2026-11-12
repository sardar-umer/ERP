/**
 * Keep a vendor bill's posted journal (expense Dr / AP Cr) in step with the bill after it is edited —
 * amounts, accounts or company. Used by the Finance bill edit and the utility-bill resubmit after a Finance return.
 */
const Account = require('../models/finance/Account');
const JournalEntry = require('../models/finance/JournalEntry');
const GeneralLedger = require('../models/finance/GeneralLedger');
const FinanceHelper = require('./financeHelper');
const { co, acct } = require('./financePosting');

/** The bill's own posted journal (not a payment, not reversed) */
const findBillPostedJournal = (bill) => JournalEntry.findOne({
  $or: [
    { referenceId: bill._id, referenceType: { $ne: 'payment' } },
    { reference: bill.billNumber, referenceType: { $ne: 'payment' } }
  ],
  status: 'posted',
  isReversed: { $ne: true }
}).sort({ createdAt: 1 });

/**
 * Plan the new lines of a bill's posted journal after the bill was edited (amounts, accounts or company).
 * Throws with a readable message when an account cannot be found in the bill's company.
 */
const buildBillJournalSync = async (bill, linkedJournal) => {
  const companyId = co(bill) || linkedJournal.companyId;
  const companyChanged = Boolean(companyId) && String(linkedJournal.companyId || '') !== String(companyId);
  const A = acct(companyId);
  const companyLabel = bill.company || 'the selected company';
  const round = (v) => Math.round((Number(v) || 0) * 100) / 100;

  if (Array.isArray(bill.lineItems) && bill.lineItems.length > 0) {
    const apAccount = await A.resolve(FinanceHelper.ACCOUNTS.PAYABLE);
    if (!apAccount) {
      throw new Error(`Accounts Payable account not found in ${companyLabel}'s chart of accounts`);
    }
    const lines = [];
    for (const li of bill.lineItems) {
      let lineAcc = li.account ? await A.map(li.account) : null;
      if (!lineAcc && li.expenseAccount) lineAcc = await A.map(li.expenseAccount);
      if (!lineAcc && li.expenseAccountNumber) {
        lineAcc = await require('./accountResolver').getAccountByNumber(companyId, li.expenseAccountNumber);
      }
      if (!lineAcc && !li.account && !li.expenseAccount && !li.expenseAccountNumber) {
        lineAcc = await A.resolve(FinanceHelper.ACCOUNTS.UTILITIES || '6200');
      }
      if (!lineAcc) {
        throw new Error(`Expense account for line "${(li.description || '').slice(0, 60)}" not found in ${companyLabel}'s chart of accounts`);
      }
      lines.push({
        account: lineAcc._id,
        description: (li.description || `Expense — ${bill.billNumber}`).slice(0, 200),
        debit: round(Number(li.quantity || 1) * Number(li.unitPrice || 0)),
        credit: 0,
        department: bill.department || linkedJournal.department
      });
    }
    const totalAmount = round(bill.totalAmount);
    const debitSum = round(lines.reduce((sum, l) => sum + l.debit, 0));
    if (Math.abs(debitSum - totalAmount) > 0.01) {
      const last = lines[lines.length - 1];
      last.debit = round(last.debit + (totalAmount - debitSum));
    }
    lines.push({
      account: apAccount._id,
      description: `Payable to ${bill.vendor?.name || 'Vendor'}`,
      debit: 0,
      credit: totalAmount,
      department: bill.department || linkedJournal.department
    });
    return { companyId, lines, total: totalAmount };
  }

  // No line items on the bill: keep the journal's amounts, only move its accounts when the company changed
  if (!companyChanged) return null;
  const lines = [];
  for (const line of linkedJournal.lines) {
    const mapped = await A.map(line.account);
    if (!mapped) {
      const old = await Account.findById(line.account).select('accountNumber name').lean();
      throw new Error(`Account ${old?.accountNumber || ''} ${old?.name || ''} not found in ${companyLabel}'s chart of accounts`.replace(/\s+/g, ' '));
    }
    const plain = line.toObject ? line.toObject() : { ...line };
    delete plain._id;
    lines.push({ ...plain, account: mapped._id });
  }
  return { companyId, lines, total: round(linkedJournal.totalDebits) };
};

/**
 * Apply a planned journal update: take the old lines off the account balances, save the new lines,
 * add them to the balances (re-saving a posted entry does not do that by itself) and repost the GL rows.
 */
const applyBillJournalSync = async (linkedJournal, plan, bill) => {
  for (const line of linkedJournal.lines) {
    await Account.findByIdAndUpdate(line.account, {
      $inc: { balance: -((Number(line.debit) || 0) - (Number(line.credit) || 0)) }
    });
  }

  if (plan.companyId) linkedJournal.companyId = plan.companyId;
  if (bill.company) linkedJournal.customCompany = bill.company;
  linkedJournal.lines = plan.lines;
  linkedJournal.totalDebits = plan.total;
  linkedJournal.totalCredits = plan.total;
  await linkedJournal.save();

  for (const line of linkedJournal.lines) {
    await Account.findByIdAndUpdate(line.account, {
      $inc: { balance: (Number(line.debit) || 0) - (Number(line.credit) || 0) }
    });
  }

  await GeneralLedger.deleteMany({ journalEntry: linkedJournal._id });
  await FinanceHelper.postToGeneralLedger(linkedJournal._id);
};

module.exports = { findBillPostedJournal, buildBillJournalSync, applyBillJournalSync };
