/**
 * Lump-sum (advance) loan payment recorded by HR outside payroll.
 *
 * Example: loan 500,000 over 5 × 100,000. One EMI deducted → 400,000 left.
 * Employee pays 200,000 at once → 200,000 left and the unpaid schedule is rebuilt:
 *   reduce_tenure (default)  → 100,000 × 2  (uneven: 250,000 left → 100k, 100k, 50k)
 *   reduce_installment       → 50,000 × 4   (same months, smaller installment)
 *
 * Paid rows stay as history. A Partial row is closed at what was actually received.
 * Pending / Overdue / Paused / pause-extension rows are replaced by the new schedule;
 * future months in loan.pausedMonths are skipped when assigning due dates.
 */

const {
  calculateRemainingMonths,
  buildPendingSchedule
} = require('./loanEmiRecalculation');
const { getLoanRemainingBalance } = require('./loanPayrollDeduction');

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const MODES = ['reduce_tenure', 'reduce_installment'];
const METHODS = ['Cash', 'Bank Transfer', 'Cheque', 'Direct Payment'];
const ALLOWED_LOAN_STATUSES = ['Approved', 'Disbursed', 'Active'];

const plain = (row) => {
  const obj = row && row.toObject ? row.toObject() : { ...row };
  return obj;
};

const monthKey = (date) => {
  const d = new Date(date);
  return `${d.getFullYear()}-${d.getMonth() + 1}`;
};

const addMonths = (date, n) => {
  const d = new Date(date);
  d.setMonth(d.getMonth() + n);
  return d;
};

/** EMI that clears `principal` in `months` (annuity; plain division when interest is 0). */
const emiForMonths = (principal, months, annualRate) => {
  const rate = (Number(annualRate) || 0) / 100 / 12;
  if (months <= 0) return 0;
  if (rate === 0) return Math.ceil(principal / months);
  const f = Math.pow(1 + rate, months);
  return Math.ceil((principal * rate * f) / (f - 1));
};

class LumpSumError extends Error {
  constructor(message) {
    super(message);
    this.statusCode = 400;
  }
}

/**
 * Build the plan (pure) and, unless dryRun, apply it to the loan document.
 */
function applyLumpSumToLoan(loan, input = {}, { dryRun = false } = {}) {
  const warnings = [];
  const mode = input.mode || 'reduce_tenure';
  const paymentMethod = input.paymentMethod || 'Cash';
  const paymentDate = input.paymentDate ? new Date(input.paymentDate) : new Date();
  let amount = round2(input.amount);

  if (!ALLOWED_LOAN_STATUSES.includes(loan.status)) {
    throw new LumpSumError(`Payments can only be recorded on approved, disbursed or active loans (this loan is ${loan.status})`);
  }
  if (!(amount > 0)) throw new LumpSumError('Enter a payment amount greater than zero');
  if (!MODES.includes(mode)) throw new LumpSumError('Invalid reschedule option');
  if (!METHODS.includes(paymentMethod)) throw new LumpSumError('Invalid payment method');
  if (Number.isNaN(paymentDate.getTime())) throw new LumpSumError('Invalid payment date');

  const rate = Number(loan.interestRate) || 0;
  const rows = (loan.loanSchedule || []).map(plain)
    .sort((a, b) => (a.installmentNumber || 0) - (b.installmentNumber || 0));

  // 1) Keep Paid rows; close Partial rows at what was received.
  const kept = [];
  for (const row of rows) {
    if (row.status === 'Paid') {
      kept.push(row);
    } else if (row.status === 'Partial') {
      const received = round2(row.paidAmount);
      if (received > 0) {
        const interestPart = round2(Math.min(Number(row.interest) || 0, received));
        kept.push({
          ...row,
          amount: received,
          interest: interestPart,
          principal: round2(received - interestPart),
          paidAmount: received,
          status: 'Paid'
        });
      } else {
        warnings.push(`Installment #${row.installmentNumber} was marked Partial with no received amount on record; treated as unpaid.`);
      }
    }
  }

  const unpaidBefore = rows.filter((r) => ['Pending', 'Overdue'].includes(r.status) ||
    (r.status === 'Partial' && !(round2(r.paidAmount) > 0)));
  const remainingInstallmentsBefore = unpaidBefore.length;

  // 2) Principal still owed = loan amount − principal already recovered.
  const paidPrincipal = kept.reduce((s, r) => s + (Number(r.principal) || 0), 0);
  const principalBefore = round2(Math.max(0, (Number(loan.loanAmount) || 0) - paidPrincipal));

  if (principalBefore <= 0.5) throw new LumpSumError('This loan has no outstanding balance');

  if (rate === 0) {
    const fromLoan = round2(getLoanRemainingBalance(loan));
    if (Math.abs(fromLoan - principalBefore) > 1) {
      warnings.push(`Outstanding from schedule (Rs ${principalBefore.toLocaleString()}) differs from the loan's recorded balance (Rs ${fromLoan.toLocaleString()}). The schedule figure is used — please verify.`);
    }
  }

  if (amount > principalBefore + 1) {
    throw new LumpSumError(`Amount exceeds the outstanding balance of Rs ${principalBefore.toLocaleString()}`);
  }
  if (amount > principalBefore) amount = principalBefore; // within Rs 1 rounding → settle exactly

  const principalAfter = round2(principalBefore - amount);
  const isFullSettlement = principalAfter <= 0.5;
  const installmentBefore = Math.round(Number(loan.monthlyInstallment) || 0);

  // 3) Where the rebuilt schedule starts: first unpaid due date, else month after last paid.
  const firstUnpaid = [...unpaidBefore].sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate))[0];
  const lastKept = kept[kept.length - 1];
  const startDueDate = firstUnpaid
    ? new Date(firstUnpaid.dueDate)
    : addMonths(lastKept ? lastKept.dueDate : paymentDate, 1);

  // 4) New pending rows
  let pending = [];
  let installmentAfter = isFullSettlement ? 0 : installmentBefore;
  if (!isFullSettlement) {
    let months;
    if (mode === 'reduce_tenure') {
      if (!(installmentBefore > 0)) throw new LumpSumError('Loan has no monthly installment set');
      try {
        months = calculateRemainingMonths(principalAfter, installmentBefore, rate);
      } catch (e) {
        throw new LumpSumError(e.message);
      }
    } else {
      months = Math.max(1, remainingInstallmentsBefore);
      installmentAfter = emiForMonths(principalAfter, months, rate);
    }

    pending = buildPendingSchedule({
      principal: principalAfter,
      emi: installmentAfter,
      interestRate: rate,
      months,
      startInstallmentNumber: 1,
      startDueDate
    });

    // Skip calendar months the loan is paused for (payroll does not deduct those months).
    const paused = new Set((loan.pausedMonths || []).map((p) => `${p.year}-${p.month}`));
    let due = new Date(startDueDate);
    for (const row of pending) {
      let guard = 0;
      while (paused.has(monthKey(due)) && guard < 60) { due = addMonths(due, 1); guard++; }
      row.dueDate = new Date(due);
      due = addMonths(due, 1);
    }
  }

  const lumpRow = {
    dueDate: paymentDate,
    amount,
    principal: amount,
    interest: 0,
    balance: principalAfter,
    status: 'Paid',
    paidAmount: amount,
    paymentDate,
    paymentMethod,
    paymentReference: input.reference || undefined,
    isLumpSum: true
  };

  // Payment-sequence order (history → lump sum → rebuilt rows) so the balance column runs down cleanly.
  const newSchedule = [...kept, lumpRow, ...pending].map((row, i) => {
    const r = { ...row, installmentNumber: i + 1 };
    delete r._id;
    return r;
  });

  const outstandingAfter = round2(pending.reduce((s, r) => s + (Number(r.amount) || 0), 0));
  const paymentType = isFullSettlement ? 'Full Settlement' : 'Lump Sum';

  const result = {
    paymentType,
    amount,
    mode,
    before: {
      principal: principalBefore,
      installment: installmentBefore,
      remainingInstallments: remainingInstallmentsBefore
    },
    after: {
      principal: isFullSettlement ? 0 : principalAfter,
      installment: installmentAfter,
      remainingInstallments: pending.length,
      outstanding: outstandingAfter,
      lastDueDate: pending.length ? pending[pending.length - 1].dueDate : null,
      loanStatus: isFullSettlement ? 'Completed' : (loan.status === 'Disbursed' ? 'Active' : loan.status)
    },
    newPendingSchedule: pending,
    warnings
  };

  if (dryRun) return result;

  // 5) Apply
  loan.loanSchedule = newSchedule;
  loan.loanTerm = newSchedule.length;
  if (!isFullSettlement) loan.monthlyInstallment = installmentAfter;
  // Stop pre-save from re-deriving EMI/totals off loanAmount/loanTerm
  loan.emiManuallyAdjusted = true;
  loan.totalPaid = round2((Number(loan.totalPaid) || 0) + amount);
  loan.totalPrincipalPaid = round2((Number(loan.totalPrincipalPaid) || 0) + amount);
  loan.outstandingBalance = outstandingAfter;
  loan.totalPayable = round2(loan.totalPaid + outstandingAfter);
  loan.status = result.after.loanStatus;

  loan.payments = loan.payments || [];
  loan.payments.push({
    paymentType,
    amount,
    paymentDate,
    paymentMethod,
    reference: input.reference,
    rescheduleMode: isFullSettlement ? undefined : mode,
    principalBefore,
    principalAfter: result.after.principal,
    installmentBefore,
    installmentAfter,
    remainingInstallmentsBefore,
    remainingInstallmentsAfter: pending.length,
    remarks: input.remarks,
    recordedBy: input.userId,
    recordedAt: new Date()
  });

  const fmt = (n) => `Rs ${Math.round(n).toLocaleString()}`;
  const noteText = isFullSettlement
    ? `Full settlement received: ${fmt(amount)} (${paymentMethod}${input.reference ? `, ref ${input.reference}` : ''}). Loan closed.`
    : `Lump sum received: ${fmt(amount)} (${paymentMethod}${input.reference ? `, ref ${input.reference}` : ''}). ` +
      `Balance ${fmt(principalBefore)} → ${fmt(principalAfter)}. ` +
      (mode === 'reduce_tenure'
        ? `Installment kept at ${fmt(installmentAfter)}; remaining installments ${remainingInstallmentsBefore} → ${pending.length}.`
        : `Installment ${fmt(installmentBefore)} → ${fmt(installmentAfter)} over ${pending.length} remaining installment(s).`);
  if (input.userId) {
    loan.notes = loan.notes || [];
    loan.notes.push({
      content: `${noteText}${input.remarks ? ` Remarks: ${input.remarks}` : ''}`.slice(0, 2000),
      addedBy: input.userId,
      addedAt: new Date()
    });
  }

  return result;
}

module.exports = { applyLumpSumToLoan, LumpSumError };
