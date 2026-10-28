/**
 * Editing a voucher's narration updates the vendor bill it was raised for, so Vendor Bills and the
 * Payables hub show the same text as the voucher. Narration only — amounts never flow back from a voucher.
 */
const mongoose = require('mongoose');
const { getBillNarration } = require('./documentNarration');

const trim = (value) => String(value ?? '').trim();
// Vouchers carry the first 500 characters of the bill narration (withVoucherNarration)
const VOUCHER_NARRATION_MAX = 500;

/** The one bill a journal entry belongs to, or null (batch payments narrate the batch, not a bill) */
const findNarrationBill = async (entry) => {
  const AccountsPayable = mongoose.model('AccountsPayable');
  if (['bill', 'advance_bill'].includes(entry.referenceType) && entry.referenceId) {
    return { bill: await AccountsPayable.findById(entry.referenceId).lean(), isPayment: false };
  }
  // Bank / cash payment vouchers and advance-applied vouchers ('payment' / 'adjustment') hang off a payment application
  const app = await mongoose.model('ApPaymentApplication')
    .findOne({ $or: [{ journalEntryId: entry._id }, { payingJournalEntryId: entry._id }] })
    .select('accountsPayableId bills')
    .lean();
  if (!app) return null;
  const billIds = [...new Set(
    ((app.bills || []).length ? app.bills.map((b) => b.billId) : [app.accountsPayableId])
      .filter(Boolean)
      .map(String)
  )];
  if (billIds.length !== 1) return null;
  return { bill: await AccountsPayable.findById(billIds[0]).lean(), isPayment: true };
};

/**
 * @param {object} entry saved JournalEntry
 * @param {string} previousDescription its description before the edit
 * @returns {Promise<string|null>} bill number that was updated
 */
const syncBillNarrationFromJournal = async (entry, previousDescription) => {
  const narration = trim(entry?.description);
  if (!narration || narration === trim(previousDescription)) return null;

  const found = await findNarrationBill(entry);
  const bill = found?.bill;
  if (!bill || bill.status === 'cancelled') return null;

  const billNarration = getBillNarration(bill);
  if (billNarration === narration) return null;
  // A payment voucher only speaks for the bill while it still carries the bill's narration;
  // if someone wrote payment-specific text on it, leave the bill alone
  if (found.isPayment && billNarration && billNarration.slice(0, VOUCHER_NARRATION_MAX) !== trim(previousDescription)) {
    return null;
  }

  // updateOne: no save hooks, so nothing but the narration changes on the bill
  await mongoose.model('AccountsPayable').updateOne({ _id: bill._id }, { $set: { notes: narration } });
  return bill.billNumber || String(bill._id);
};

module.exports = { syncBillNarrationFromJournal };
