/**
 * Server copy of client/src/utils/invoiceGracePeriodUtils.js.
 * Keep both in sync: the Invoices page shows per-row values from the client util
 * and accumulated totals from this one, so they must give the same numbers.
 *
 * Late surcharge (10% of month charges) applies ONLY to Electricity invoices that
 * were not fully paid within dueDate + GRACE_PERIOD_DAYS and are now past that date.
 */

const GRACE_PERIOD_DAYS = 6;

function getAdjustedGrandTotal(invoice) {
  if (!invoice) return 0;

  let chargesForMonth = invoice.subtotal || 0;
  if (Array.isArray(invoice.charges) && invoice.charges.length > 0) {
    const sum = invoice.charges.reduce((s, ch) => s + (ch.amount || 0), 0);
    if (sum > 0) chargesForMonth = sum;
  }
  const arrears = invoice.totalArrears ?? invoice.effectiveArrears ?? 0;
  const baseAmount = chargesForMonth + arrears;

  const chargeTypes = Array.isArray(invoice.chargeTypes) ? invoice.chargeTypes : [];
  if (!chargeTypes.includes('ELECTRICITY')) return invoice.grandTotal ?? baseAmount;
  if (!invoice.dueDate) return invoice.grandTotal ?? baseAmount;

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const graceEndDate = new Date(invoice.dueDate);
  graceEndDate.setHours(0, 0, 0, 0);
  graceEndDate.setDate(graceEndDate.getDate() + GRACE_PERIOD_DAYS);
  const isOverdue = todayStart > graceEndDate;

  let paidWithinGracePeriod = false;
  if (Array.isArray(invoice.payments) && invoice.payments.length > 0) {
    const paidInGrace = invoice.payments.reduce((sum, p) => {
      if (!p.paymentDate) return sum;
      const d = new Date(p.paymentDate);
      d.setHours(0, 0, 0, 0);
      return d <= graceEndDate ? sum + (p.amount || 0) : sum;
    }, 0);
    if (paidInGrace >= baseAmount) paidWithinGracePeriod = true;
  }

  if (!isOverdue || paidWithinGracePeriod) return baseAmount;
  return baseAmount + Math.max(Math.round(chargesForMonth * 0.1), 0);
}

function getAdjustedBalance(invoice) {
  if (!invoice) return 0;
  return Math.max(0, getAdjustedGrandTotal(invoice) - (invoice.totalPaid || 0));
}

module.exports = { GRACE_PERIOD_DAYS, getAdjustedGrandTotal, getAdjustedBalance };
