/**
 * Shared loan → payroll deduction rules.
 * Stops salary deduction once the loan principal/schedule is fully paid,
 * even if status was not flipped to Completed.
 */

const ACTIVE_LOAN_STATUSES = ['Active', 'Disbursed', 'Approved'];
const UNPAID_INSTALLMENT_STATUSES = ['Pending', 'Overdue', 'Partial'];

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** Remaining amount still owed on a loan (schedule-aware). */
function getLoanRemainingBalance(loan) {
  if (!loan) return 0;

  let fromSchedule = null;
  if (Array.isArray(loan.loanSchedule) && loan.loanSchedule.length > 0) {
    fromSchedule = loan.loanSchedule.reduce((sum, inst) => {
      if (!UNPAID_INSTALLMENT_STATUSES.includes(inst.status)) return sum;
      const due = Number(inst.amount) || 0;
      const paid = Number(inst.paidAmount) || 0;
      return sum + Math.max(0, due - paid);
    }, 0);
    // All installments paid → nothing left to deduct
    if (fromSchedule <= 0.009) return 0;
  }

  const outstanding = Number(loan.outstandingBalance);
  if (Number.isFinite(outstanding) && outstanding <= 0.009) return 0;

  const totalPaid = Number(loan.totalPaid) || 0;
  const totalPayable = Number(loan.totalPayable) || Number(loan.loanAmount) || 0;
  const fromTotals = Math.max(0, round2(totalPayable - totalPaid));
  if (fromTotals <= 0.009) return 0;

  // Prefer the tighter of schedule remaining vs outstanding/totals
  const candidates = [fromTotals];
  if (Number.isFinite(outstanding) && outstanding > 0) candidates.push(outstanding);
  if (fromSchedule != null) candidates.push(fromSchedule);
  return round2(Math.max(0, Math.min(...candidates)));
}

function isLoanFullyPaid(loan) {
  if (!loan) return true;
  if (loan.status === 'Completed') return true;
  return getLoanRemainingBalance(loan) <= 0.009;
}

/**
 * Amount to deduct from payroll for this loan in month/year.
 * Returns 0 when paused, completed, or fully paid; otherwise EMI capped to remaining.
 */
/**
 * True when the payroll month is before the loan's Deduction Start Month (deduct nothing yet).
 * Loans without a start month set are never held back.
 */
function isBeforeDeductionStart(loan, month, year) {
  const sm = Number(loan?.deductionStartMonth);
  const sy = Number(loan?.deductionStartYear);
  if (!sm || !sy) return false;
  const m = Number(month);
  const y = Number(year);
  if (!m || !y) return false;
  return y * 12 + m < sy * 12 + sm;
}

function effectiveLoanDeductionForPayroll(loan, month, year) {
  if (!loan) return 0;
  if (!ACTIVE_LOAN_STATUSES.includes(loan.status)) return 0;

  const m = Number(month);
  const y = Number(year);
  if (isBeforeDeductionStart(loan, m, y)) return 0;
  if (
    Array.isArray(loan.pausedMonths) &&
    loan.pausedMonths.some((p) => Number(p.month) === m && Number(p.year) === y)
  ) {
    return 0;
  }

  const remaining = getLoanRemainingBalance(loan);
  if (remaining <= 0.009) return 0;

  const emi = Number(loan.monthlyInstallment) || 0;
  if (emi <= 0) return 0;

  return round2(Math.min(emi, remaining));
}

/** Mongo filter for loans that may still be deducted (status only — always check remaining in code). */
function activeLoanStatusFilter() {
  return { status: { $in: ACTIVE_LOAN_STATUSES } };
}

/**
 * If a loan looks fully paid but status is still Active/Disbursed, mark Completed.
 * Safe to call during payroll generation.
 */
async function markLoanCompletedIfPaid(loan) {
  if (!loan || loan.status === 'Completed') return false;
  if (!isLoanFullyPaid(loan)) return false;
  loan.status = 'Completed';
  loan.completionDate = loan.completionDate || new Date();
  loan.outstandingBalance = 0;
  await loan.save();
  return true;
}

/**
 * Why a paid payroll must NOT be applied to this loan again (or null when it should be applied).
 * - The same payroll was already applied (rows carry paymentReference `Payroll-<id>`).
 * - The installment due in the payroll's month is already Paid but not by any payroll —
 *   i.e. it was recorded by the loan import / manually, so that month's deduction is already on the loan.
 * An installment paid by a *different* payroll (catch-up of an older month) does not block.
 */
function payrollAlreadyRecordedOnLoan(loan, payroll) {
  if (!loan || !payroll) return null;
  const ref = `Payroll-${payroll._id}`;
  const rows = Array.isArray(loan.loanSchedule) ? loan.loanSchedule : [];

  const applied = Array.isArray(loan.appliedPayrolls) ? loan.appliedPayrolls : [];
  if (applied.some((id) => String(id) === String(payroll._id)) || rows.some((r) => r.paymentReference === ref)) {
    return 'this payroll was already applied to the loan';
  }

  const m = Number(payroll.month);
  const y = Number(payroll.year);
  const monthRow = rows.find((r) => {
    if (r.isLumpSum || r.isPauseExtension || !r.dueDate) return false;
    const d = new Date(r.dueDate);
    return d.getMonth() + 1 === m && d.getFullYear() === y;
  });
  if (
    monthRow &&
    monthRow.status === 'Paid' &&
    !String(monthRow.paymentReference || '').startsWith('Payroll-')
  ) {
    return `installment #${monthRow.installmentNumber} for ${m}/${y} is already marked Paid (${monthRow.paymentMethod || 'recorded earlier'})`;
  }
  return null;
}

module.exports = {
  payrollAlreadyRecordedOnLoan,
  ACTIVE_LOAN_STATUSES,
  getLoanRemainingBalance,
  isLoanFullyPaid,
  effectiveLoanDeductionForPayroll,
  isBeforeDeductionStart,
  activeLoanStatusFilter,
  markLoanCompletedIfPaid
};
