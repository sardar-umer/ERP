/**
 * Resident ledger display — matches "Pay Invoices from Deposit" (Taj Residents):
 * arrears appear only on the earliest owing invoice per property within each charge-type section;
 * later invoices show current-period amount/balance only.
 */

const GRACE_PERIOD_DAYS = 6;

/** Payable total for an invoice (includes late surcharge after due + grace). */
export const getLedgerInvoiceDisplayAmount = (inv) => {
  if (!inv) return 0;

  let chargesForMonth = Number(inv.subtotal) || 0;
  if (inv.charges && Array.isArray(inv.charges) && inv.charges.length > 0) {
    const totalChargesAmount = inv.charges.reduce((sum, charge) => sum + (Number(charge.amount) || 0), 0);
    if (totalChargesAmount > 0) chargesForMonth = totalChargesAmount;
  }
  const totalArrears = Number(inv.totalArrears) || 0;
  const baseAmount = chargesForMonth + totalArrears;

  const invoiceDueDate = inv.dueDate ? new Date(inv.dueDate) : null;
  if (!invoiceDueDate) return Number(inv.grandTotal) || baseAmount;

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const dueStart = new Date(invoiceDueDate);
  dueStart.setHours(0, 0, 0, 0);
  const graceEndDate = new Date(dueStart);
  graceEndDate.setDate(graceEndDate.getDate() + GRACE_PERIOD_DAYS);
  const isOverdue = todayStart > graceEndDate;
  const isUnpaid =
    inv.paymentStatus === 'unpaid' ||
    inv.paymentStatus === 'partial_paid' ||
    (Number(inv.balance) || 0) > 0;

  if (!isOverdue || !isUnpaid) {
    return Number(inv.grandTotal) || baseAmount;
  }

  const latePaymentSurcharge = Math.max(Math.round(chargesForMonth * 0.1), 0);
  const originalGrandTotal = chargesForMonth + totalArrears;
  const storedGrandTotal = Number(inv.grandTotal) || 0;
  const surchargeAlreadyIncluded = storedGrandTotal > originalGrandTotal;
  return surchargeAlreadyIncluded ? storedGrandTotal : baseAmount + latePaymentSurcharge;
};

export const sortLedgerInvoicesByPeriod = (list = []) =>
  [...list].sort((a, b) => {
    const pA = a.periodFrom || a.invoiceDate || '';
    const pB = b.periodFrom || b.invoiceDate || '';
    const cmp = String(pA).localeCompare(String(pB));
    if (cmp !== 0) return cmp;
    return String(a.invoiceDate || '').localeCompare(String(b.invoiceDate || ''));
  });

/**
 * @param {object[]} invoices - single charge-type section (CAM, WATER, etc.)
 * @returns {{ inv, invoiceAmount, arrears, amountDue, balance, isFirst }[]}
 */
const invoiceStillOwes = (inv) => {
  const balance = Number(inv.balance) || 0;
  if (balance > 0) return true;
  const status = String(inv.paymentStatus || '').toLowerCase();
  return status === 'unpaid' || status === 'partial_paid';
};

const ledgerPropertyKey = (inv) => String(inv?.property?._id ?? inv?.property ?? '');

export const buildLedgerSectionDisplayRows = (invoices = []) => {
  const sorted = sortLedgerInvoicesByPeriod(invoices);
  // Same as Pay Invoices from Deposit (one property at a time): per property, the earliest period
  // among invoices that still owe carries the arrears. A resident with several properties has one
  // arrears chain per property, so each property's opening arrears is kept.
  const firstIds = new Set();
  const byProperty = {};
  sorted.forEach((inv) => { (byProperty[ledgerPropertyKey(inv)] = byProperty[ledgerPropertyKey(inv)] || []).push(inv); });
  Object.values(byProperty).forEach((list) => {
    const first = list.find(invoiceStillOwes) ?? list[0];
    if (first) firstIds.add(String(first._id));
  });

  return sorted.map((inv) => {
    const displayAmount = getLedgerInvoiceDisplayAmount(inv);
    const totalPaid = Number(inv.totalPaid) || 0;
    const totalArrears = Number(inv.totalArrears) || 0;
    const isFirst = firstIds.has(String(inv._id));

    const invoiceAmount = Math.max(0, displayAmount - totalArrears);
    const arrears = isFirst && totalArrears > 0 ? totalArrears : null;
    const amountDue = isFirst ? displayAmount : Math.max(0, displayAmount - totalArrears);
    const balance = isFirst
      ? Math.max(0, displayAmount - totalPaid)
      : Math.max(0, displayAmount - totalArrears - totalPaid);

    return { inv, invoiceAmount, arrears, amountDue, balance, isFirst };
  });
};

/** Sum display balances across all invoice sections (no double-counted arrears). */
export const getLedgerTotalOutstandingBalance = (invoiceLists = []) => {
  let total = 0;
  invoiceLists.forEach((list) => {
    buildLedgerSectionDisplayRows(list).forEach((row) => {
      total += row.balance;
    });
  });
  return total;
};

export const sumLedgerSectionTotals = (rows = []) => ({
  invoiceAmount: rows.reduce((s, r) => s + r.invoiceAmount, 0),
  arrears: rows.reduce((s, r) => s + (r.arrears || 0), 0),
  amountDue: rows.reduce((s, r) => s + r.amountDue, 0),
  balance: rows.reduce((s, r) => s + r.balance, 0)
});
