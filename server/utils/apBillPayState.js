/**
 * Can this vendor bill be paid now? One rule for every screen that offers "Pay" (Payables hub, bill page,
 * vendor list), matching the Vendor Bills page: the bill has reached Finance (not draft / in department or audit
 * approval / returned), and something is left after cash paid, advances applied and payments or advance
 * adjustments already created and waiting for finance authorities.
 */
const FinanceHelper = require('./financeHelper');
const { isFullAdvancePaymentTerm, vendorAdvanceCommittedToPo } = require('./fullAdvancePoGate');

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const NOT_AT_FINANCE = ['draft', 'Pending Audit', 'Forwarded to Audit Director', 'Returned from Audit', 'Returned from Finance'];

const getBillPayState = (bill) => {
  const payable = round2(FinanceHelper.getAPPayableBase(bill));
  const settled = round2((Number(bill.amountPaid) || 0) + (Number(bill.advanceApplied) || 0));
  const pending = round2((Number(bill.paymentPending) || 0) + (Number(bill.advancePending) || 0));
  const balance = round2(Math.max(0, payable - settled));
  const payableNow = round2(Math.max(0, balance - pending));

  let reason = '';
  if (bill.status === 'cancelled') reason = 'Bill is void';
  else if (balance <= 0.01 || bill.status === 'paid') reason = 'Fully paid';
  else if (bill.approvalStatus === 'Submitted') reason = 'Waiting for department approval';
  else if (bill.approvalStatus === 'Rejected') reason = 'Rejected in department approval';
  else if (bill.status === 'draft') reason = 'Not yet sent to Finance';
  else if (bill.status === 'Returned from Finance') reason = 'Returned from Finance to the initiator';
  else if (NOT_AT_FINANCE.includes(bill.status)) reason = 'In audit — not yet at Finance';
  else if (payableNow <= 0.01) reason = 'Payment already created — waiting for finance authorities';

  return { payable, settled, pending, balance, payableNow, canPay: !reason, reason };
};

/**
 * PO advance: same rule as the Vendor Advance PO queue — the PO is at Pending Finance on full-advance terms, and
 * something remains after every advance already recorded against it (pending, approved or signed; not rejected).
 * `advances` are the VendorAdvance rows linked to this PO.
 */
const getPoAdvancePayState = (po, advances = []) => {
  const total = round2(po.totalAmount);
  const committed = round2(advances.filter(vendorAdvanceCommittedToPo).reduce((t, a) => t + (Number(a.amount) || 0), 0));
  const pending = round2(advances.filter((a) => a.voucherWorkflowStatus === 'pending_authority').reduce((t, a) => t + (Number(a.amount) || 0), 0));
  const paid = round2(committed - pending);
  const remaining = round2(Math.max(0, total - committed));

  let reason = '';
  if (po.status !== 'Pending Finance') reason = `Not at Finance (${po.status})`;
  else if (!isFullAdvancePaymentTerm(po.paymentTerms)) reason = 'PO is not on advance payment terms';
  else if (remaining <= 0.009) reason = pending > 0.009 ? 'Advance already created — waiting for finance authorities' : 'Advance fully paid';

  return { total, committed, pending, paid, remaining, canPay: !reason, reason };
};

module.exports = { getBillPayState, getPoAdvancePayState, NOT_AT_FINANCE };
