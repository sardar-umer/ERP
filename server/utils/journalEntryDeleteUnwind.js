/**
 * Fully unwind operational + accounting impact when a Journal Entry / voucher is deleted.
 * Keeps Trial Balance, Chart of Accounts balances, AR/AP, Cash Approvals, advances, banking, payroll in sync.
 */
const mongoose = require('mongoose');
const Account = require('../models/finance/Account');
const GeneralLedger = require('../models/finance/GeneralLedger');
const FinanceHelper = require('./financeHelper');

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const reverseAccountBalances = async (entry) => {
  if (!entry || entry.status !== 'posted') return;
  for (const line of entry.lines || []) {
    const accountId = line.account?._id || line.account;
    if (!accountId) continue;
    const delta = (Number(line.debit) || 0) - (Number(line.credit) || 0);
    if (!delta) continue;
    await Account.findByIdAndUpdate(accountId, { $inc: { balance: -delta } });
  }
};

const unwindApPaymentApplications = async (entryId) => {
  const ApPaymentApplication = require('../models/finance/ApPaymentApplication');
  const AccountsPayable = require('../models/finance/AccountsPayable');
  const CashApproval = require('../models/procurement/CashApproval');
  const VendorAdvance = require('../models/finance/VendorAdvance');

  const apps = await ApPaymentApplication.find({
    $or: [{ journalEntryId: entryId }, { payingJournalEntryId: entryId }]
  });
  for (const app of apps) {
    // If only the paying-company voucher is deleted, clear the link and keep the bill-company settlement
    if (
      app.payingJournalEntryId
      && String(app.payingJournalEntryId) === String(entryId)
      && String(app.journalEntryId) !== String(entryId)
    ) {
      app.payingJournalEntryId = null;
      await app.save();
      continue;
    }

    const billsToProcess =
      app.bills?.length > 0
        ? app.bills
        : app.accountsPayableId
          ? [{ billId: app.accountsPayableId, amount: app.amount }]
          : [];

    const fullyApproved = app.workflowStatus === 'fully_approved';
    const refToMatch = app.paymentMeta?.reference;

    for (const item of billsToProcess) {
      const bill = await AccountsPayable.findById(item.billId);
      if (!bill) continue;
      const amountToRemove = round2(item.amount);

      if (fullyApproved) {
        if (app.sourceType === 'bank_payment') {
          if (Array.isArray(bill.payments)) {
            let paymentIndex = bill.payments.findIndex(
              (p) =>
                (p.journalEntry && String(p.journalEntry) === String(entryId)) ||
                (refToMatch && p.reference === refToMatch && round2(p.amount) === amountToRemove)
            );
            if (paymentIndex < 0 && refToMatch) {
              paymentIndex = bill.payments.findIndex(
                (p) => p.reference === refToMatch && round2(p.amount) === amountToRemove
              );
            }
            if (paymentIndex > -1) bill.payments.splice(paymentIndex, 1);
          }
          bill.amountPaid = round2(Math.max(0, Number(bill.amountPaid || 0) - amountToRemove));
        } else if (app.sourceType === 'cash_approval') {
          bill.advanceApplied = round2(Math.max(0, Number(bill.advanceApplied || 0) - amountToRemove));
          if (Array.isArray(bill.employeeAdvanceAllocations) && app.cashApprovalId) {
            bill.employeeAdvanceAllocations = bill.employeeAdvanceAllocations.filter(
              (a) =>
                !(
                  String(a.cashApprovalId) === String(app.cashApprovalId) &&
                  round2(a.amount) === amountToRemove
                )
            );
          }
          if (app.cashApprovalId) {
            const ca = await CashApproval.findById(app.cashApprovalId);
            if (ca) {
              ca.apAdvanceApplied = round2(Math.max(0, Number(ca.apAdvanceApplied || 0) - amountToRemove));
              await ca.save();
            }
          }
        } else if (app.sourceType === 'vendor_advance') {
          bill.advanceApplied = round2(Math.max(0, Number(bill.advanceApplied || 0) - amountToRemove));
          if (app.vendorAdvanceId) {
            const adv = await VendorAdvance.findById(app.vendorAdvanceId);
            if (adv) {
              adv.appliedAmount = round2(Math.max(0, Number(adv.appliedAmount || 0) - amountToRemove));
              if (Array.isArray(adv.allocations)) {
                adv.allocations = adv.allocations.filter(
                  (a) =>
                    !(
                      String(a.billId) === String(bill._id) &&
                      round2(a.amount) === amountToRemove
                    )
                );
              }
              const rem = round2((Number(adv.amount) || 0) - (Number(adv.appliedAmount) || 0));
              if (adv.appliedAmount <= 0.01) adv.status = 'open';
              else if (rem > 0.01) adv.status = 'partially_applied';
              else adv.status = 'applied';
              await adv.save();
            }
          }
        }
      } else {
        // Pending / in-workflow: release reserved pending amounts
        if (app.sourceType === 'bank_payment') {
          bill.paymentPending = round2(Math.max(0, Number(bill.paymentPending || 0) - amountToRemove));
        } else {
          bill.advancePending = round2(Math.max(0, Number(bill.advancePending || 0) - amountToRemove));
        }
      }

      FinanceHelper._updateDocumentStatus(bill);
      bill.markModified('payments');
      bill.markModified('employeeAdvanceAllocations');
      await bill.save();
    }

    await ApPaymentApplication.findByIdAndDelete(app._id);

    // Primary (bill-company) voucher deleted → also cancel the linked paying-company draft
    if (
      app.payingJournalEntryId
      && String(app.payingJournalEntryId) !== String(entryId)
    ) {
      const JournalEntry = require('../models/finance/JournalEntry');
      const payingJe = await JournalEntry.findById(app.payingJournalEntryId);
      if (payingJe && payingJe.status === 'draft') {
        payingJe.status = 'cancelled';
        await payingJe.save();
      }
    }
  }
};

const unwindAccountsReceivable = async (entry) => {
  const AccountsReceivable = require('../models/finance/AccountsReceivable');
  const isReceiptType = ['receipt', 'payment'].includes(String(entry.referenceType || ''));

  let invoice = null;
  if (entry.referenceId && isReceiptType) {
    invoice = await AccountsReceivable.findById(entry.referenceId);
  }
  if (!invoice) {
    invoice = await AccountsReceivable.findOne({ 'payments.journalEntry': entry._id });
  }
  if (!invoice) {
    invoice = await AccountsReceivable.findOne({ 'installments.lastJournalEntry': entry._id });
  }
  if (!invoice) return;

  if (!Array.isArray(invoice.payments)) invoice.payments = [];
  if (!Array.isArray(invoice.installments)) invoice.installments = [];

  let paymentIndex = invoice.payments.findIndex(
    (p) => p.journalEntry && String(p.journalEntry) === String(entry._id)
  );

  if (paymentIndex < 0 && isReceiptType) {
    const bankLine = (entry.lines || []).find((l) => Number(l.debit) > 0);
    const amountToMatch = bankLine ? round2(bankLine.debit) : 0;
    if (amountToMatch > 0) {
      paymentIndex = invoice.payments.findIndex((p) => {
        const amtOk = round2(p.amount) === amountToMatch;
        if (!amtOk) return false;
        if (entry.reference && p.reference) return String(p.reference) === String(entry.reference);
        return !p.journalEntry;
      });
    }
  }

  let amountToRemove = 0;
  let installmentId = null;
  let touched = false;

  if (paymentIndex > -1) {
    const pay = invoice.payments[paymentIndex];
    amountToRemove = round2(pay.amount);
    installmentId = pay.installmentId || null;
    invoice.payments.splice(paymentIndex, 1);
    touched = true;
  } else {
    const bankLine = (entry.lines || []).find((l) => Number(l.debit) > 0);
    amountToRemove = bankLine ? round2(bankLine.debit) : 0;
  }

  const reverseInstallment = (inst, { clearVoucher = true } = {}) => {
    if (!inst) return false;
    if (amountToRemove > 0) {
      inst.paidAmount = round2(Math.max(0, Number(inst.paidAmount || 0) - amountToRemove));
    } else if (clearVoucher && String(inst.lastJournalEntry || '') === String(entry._id)) {
      inst.paidAmount = 0;
    }
    if (clearVoucher) {
      inst.lastJournalEntry = null;
      inst.lastPaymentDate = null;
    }
    if (inst.paidAmount <= 0.01) {
      inst.paidAmount = 0;
      const due = inst.dueDate ? new Date(inst.dueDate) : null;
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      inst.status = due && due < today ? 'overdue' : 'pending';
    } else {
      inst.status = 'partial';
    }
    return true;
  };

  const reversedIds = new Set();

  if (installmentId) {
    const inst = invoice.installments.id
      ? invoice.installments.id(installmentId)
      : (invoice.installments || []).find((i) => String(i._id) === String(installmentId));
    if (reverseInstallment(inst, { clearVoucher: true })) {
      reversedIds.add(String(inst._id));
      touched = true;
    }
  }

  (invoice.installments || []).forEach((inst) => {
    if (reversedIds.has(String(inst._id))) return;
    if (String(inst.lastJournalEntry || '') === String(entry._id)) {
      if (reverseInstallment(inst, { clearVoucher: true })) {
        reversedIds.add(String(inst._id));
        touched = true;
      }
    }
  });

  if (reversedIds.size === 0 && amountToRemove > 0) {
    const desc = `${entry.description || ''} ${(entry.lines || []).map((l) => l.description || '').join(' ')}`;
    const m = desc.match(/Installment\s*#\s*(\d+)/i);
    if (m) {
      const seq = Number(m[1]);
      const inst = (invoice.installments || []).find((i) => Number(i.sequence) === seq);
      if (inst && reverseInstallment(inst, { clearVoucher: true })) {
        reversedIds.add(String(inst._id));
        touched = true;
      }
    }
  }

  if (touched || reversedIds.size > 0) {
    if (amountToRemove > 0) {
      invoice.amountPaid = round2(Math.max(0, Number(invoice.amountPaid || 0) - amountToRemove));
    }
    FinanceHelper._updateDocumentStatus(invoice);
    invoice.markModified('payments');
    invoice.markModified('installments');
    await invoice.save();
  }
};

const unwindLegacyApPayments = async (entryId) => {
  const AccountsPayable = require('../models/finance/AccountsPayable');
  const bills = await AccountsPayable.find({ 'payments.journalEntry': entryId });
  for (const bill of bills) {
    let removed = 0;
    bill.payments = (bill.payments || []).filter((p) => {
      if (p.journalEntry && String(p.journalEntry) === String(entryId)) {
        removed = round2(removed + Number(p.amount || 0));
        return false;
      }
      return true;
    });
    if (removed > 0) {
      bill.amountPaid = round2(Math.max(0, Number(bill.amountPaid || 0) - removed));
      FinanceHelper._updateDocumentStatus(bill);
      bill.markModified('payments');
      await bill.save();
    }
  }
};

const unwindCashApprovals = async (entryId) => {
  const CashApproval = require('../models/procurement/CashApproval');
  const cas = await CashApproval.find({ voucherEntryId: entryId });
  for (const ca of cas) {
    ca.voucherEntryId = null;
    if (ca.status === 'Advance Issued') {
      // Allow re-issue after voucher delete
      ca.status = 'Finance Authority Approved';
    }
    await ca.save();
  }
};

const unwindVendorAdvances = async (entryId) => {
  const VendorAdvance = require('../models/finance/VendorAdvance');
  const advances = await VendorAdvance.find({
    $or: [{ journalEntryId: entryId }, { payingJournalEntryId: entryId }]
  });
  for (const adv of advances) {
    if (adv.journalEntryId && String(adv.journalEntryId) === String(entryId)) {
      adv.journalEntryId = null;
    }
    if (adv.payingJournalEntryId && String(adv.payingJournalEntryId) === String(entryId)) {
      adv.payingJournalEntryId = null;
    }
    if (adv.voucherWorkflowStatus === 'fully_approved' || adv.voucherWorkflowStatus === 'immediate') {
      adv.voucherWorkflowStatus = 'rejected';
    }
    await adv.save();
  }
};

const unwindBankingTransactions = async (entryId) => {
  const Banking = require('../models/finance/Banking');
  const accounts = await Banking.find({ 'transactions.journalEntry': entryId });
  for (const bank of accounts) {
    const before = (bank.transactions || []).length;
    bank.transactions = (bank.transactions || []).filter(
      (t) => !(t.journalEntry && String(t.journalEntry) === String(entryId))
    );
    if (bank.transactions.length !== before) {
      bank.markModified('transactions');
      // pre-save recalculates currentBalance from remaining transactions
      await bank.save();
    }
  }
};

const unwindPayrollApplications = async (entryId) => {
  const PayrollPeriodPaymentApplication = require('../models/finance/PayrollPeriodPaymentApplication');
  await PayrollPeriodPaymentApplication.deleteMany({ journalEntryId: entryId });
};

const unwindPayrollBankLetters = async (entryId) => {
  try {
    const PayrollBankLetter = require('../models/finance/PayrollBankLetter');
    await PayrollBankLetter.deleteMany({ journalEntryId: entryId });
  } catch (_) {
    // model may not exist in all deployments
  }
};

const unwindLandInstallmentVouchers = async (entryId) => {
  try {
    const LandPurchase = require('../models/tajResidencia/LandPurchase');
    const purchases = await LandPurchase.find({ 'installments.voucherEntryId': entryId });
    for (const doc of purchases) {
      let changed = false;
      (doc.installments || []).forEach((row) => {
        if (row.voucherEntryId && String(row.voucherEntryId) === String(entryId)) {
          row.voucherEntryId = null;
          changed = true;
        }
      });
      if (changed) {
        doc.markModified('installments');
        await doc.save();
      }
    }
  } catch (_) {
    /* optional */
  }
  try {
    const LandTransfer = require('../models/tajResidencia/LandTransfer');
    const transfers = await LandTransfer.find({ 'transferPayments.voucherEntryId': entryId });
    for (const doc of transfers) {
      let changed = false;
      (doc.transferPayments || []).forEach((row) => {
        if (row.voucherEntryId && String(row.voucherEntryId) === String(entryId)) {
          row.voucherEntryId = null;
          changed = true;
        }
      });
      if (changed) {
        doc.markModified('transferPayments');
        await doc.save();
      }
    }
  } catch (_) {
    /* optional */
  }
};

const unwindGoodsReceiveLinks = async (entryId) => {
  try {
    const GoodsReceive = require('../models/procurement/GoodsReceive');
    await GoodsReceive.updateMany(
      { journalEntry: entryId },
      { $unset: { journalEntry: 1 } }
    );
  } catch (_) {
    /* optional */
  }
};

/**
 * @param {import('mongoose').Document} entry - JournalEntry document (not yet deleted)
 * @returns {Promise<{ entryId: string }>}
 */
const unwindJournalEntryOnDelete = async (entry) => {
  if (!entry?._id) throw new Error('Journal entry required');
  const entryId = entry._id;

  // 0) Loan lump-sum receipt: restore the loan first — throws (and blocks the delete) if the loan moved on
  const { undoLumpSumForJournalEntry } = require('./loanLumpSumFinance');
  await undoLumpSumForJournalEntry(entryId, { note: 'deleted' });

  // 1) Operational reverse (before JE/GL gone)
  await unwindApPaymentApplications(entryId);
  await unwindLegacyApPayments(entryId);
  await unwindAccountsReceivable(entry);
  await unwindCashApprovals(entryId);
  await unwindVendorAdvances(entryId);
  await unwindBankingTransactions(entryId);
  await unwindPayrollApplications(entryId);
  await unwindPayrollBankLetters(entryId);
  await unwindLandInstallmentVouchers(entryId);
  await unwindGoodsReceiveLinks(entryId);

  // 2) Chart of Accounts / cached balances (TB CoA views)
  await reverseAccountBalances(entry);

  // 3) General ledger rows
  await GeneralLedger.deleteMany({ journalEntry: entryId });

  // 4) Journal entry itself
  const JournalEntry = mongoose.model('JournalEntry');
  await JournalEntry.findByIdAndDelete(entryId);

  return { entryId: String(entryId) };
};

module.exports = {
  unwindJournalEntryOnDelete,
  reverseAccountBalances
};
