/**
 * Final Settlement → Finance hand-off.
 *
 * When the CEO approves a final settlement, a payable (AP bill) is created for the employee under the
 * settlement's company: DR 5002 Salaries Expense / CR 2001 Accounts Payable for the net settlement amount.
 * Finance pays it from Payables — Bills, POs & Cash Approvals with the normal bill payment window
 * (finance authorities, bank, voucher). When that bill is fully paid the settlement becomes Paid.
 */
const mongoose = require('mongoose');
const AccountsPayable = require('../models/finance/AccountsPayable');
const FinanceHelper = require('./financeHelper');
const { getBillPayState } = require('./apBillPayState');

const SALARIES_EXPENSE = FinanceHelper.ACCOUNTS.EXPENSE_SALARIES; // 5002

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const actorId = (u) => (u && typeof u === 'object' ? (u._id || u.id) : u) || null;

const settlementNumber = (s) => `FS-${s.employeeId || 'EMP'}-${String(s._id).slice(-6).toUpperCase()}`;

const notifyFinance = async (settlement, bill, createdBy) => {
  try {
    const User = require('../models/User');
    const { createAndEmitNotification } = require('../services/realtimeNotificationService');
    const users = await User.find({ isActive: true, role: { $in: ['finance_manager', 'admin', 'super_admin'] } }).select('_id').lean();
    if (!users.length) return;
    await createAndEmitNotification({
      recipientIds: users.map((u) => String(u._id)),
      title: 'Final settlement ready for payment',
      message: `Final settlement of ${settlement.employeeName} (${settlement.employeeId}) — PKR ${Number(bill.totalAmount || 0).toLocaleString()} is in Payables.`,
      type: 'info',
      category: 'approval',
      priority: 'medium',
      actionUrl: '/finance/payables-hub',
      createdBy,
      excludeUserId: createdBy,
      metadata: { module: 'finance', entityId: bill._id, entityType: 'AccountsPayable', finalSettlementId: settlement._id }
    });
  } catch (err) {
    console.error('Final settlement finance notification failed:', err.message);
  }
};

/**
 * Create the AP bill for a CEO-approved settlement (idempotent — an existing bill is re-linked).
 * Saves the settlement. Never throws: a failure is stored on `financePostError` so HR can retry.
 * @returns {{ posted: boolean, billNumber?: string, error?: string }}
 */
const postFinalSettlementToFinance = async (settlement, user) => {
  const createdBy = actorId(user);
  try {
    if (!settlement.companyId) {
      throw Object.assign(new Error('Select the company for this settlement before sending it to Finance'), { statusCode: 400 });
    }
    if (settlement.workflowStatus !== 'Approved by CEO' && settlement.workflowStatus !== 'Pending Finance') {
      throw Object.assign(new Error(`Only CEO-approved settlements go to Finance (status: ${settlement.workflowStatus})`), { statusCode: 400 });
    }

    let bill = settlement.financeApBillId ? await AccountsPayable.findById(settlement.financeApBillId) : null;
    if (!bill || bill.status === 'cancelled') {
      bill = await AccountsPayable.findOne({ referenceType: 'final_settlement', referenceId: settlement._id, status: { $ne: 'cancelled' } });
    }

    if (!bill) {
      const amount = round2(settlement.netSettlementAmount);
      if (amount <= 0) {
        throw Object.assign(new Error('Net settlement amount is zero — nothing for Finance to pay'), { statusCode: 400 });
      }
      let billNumber = settlementNumber(settlement);
      if (await AccountsPayable.exists({ billNumber })) billNumber = `${billNumber}-${Date.now().toString().slice(-5)}`;
      const today = new Date();
      const dueEndOfDay = new Date(today); dueEndOfDay.setHours(23, 59, 59, 999); // payable today, not "overdue" at creation
      const bank = settlement.bankDetails || {};
      const notes = [
        `Final settlement (${String(settlement.settlementType || '').replace(/_/g, ' ')}) — ${settlement.employeeName} (${settlement.employeeId})`,
        settlement.designation && settlement.designation !== 'Unknown' ? `Designation: ${settlement.designation}` : null,
        settlement.department && settlement.department !== 'Unknown' ? `Department: ${settlement.department}` : null,
        settlement.lastWorkingDate ? `Last working date: ${new Date(settlement.lastWorkingDate).toISOString().slice(0, 10)}` : null,
        settlement.paymentMethod ? `Payment method: ${settlement.paymentMethod.replace(/_/g, ' ')}` : null,
        bank.bankName || bank.accountNumber ? `Bank: ${[bank.bankName, bank.accountTitle, bank.accountNumber].filter(Boolean).join(' / ')}` : null
      ].filter(Boolean).join('. ');

      bill = await FinanceHelper.createAPFromBill({
        companyId: settlement.companyId,
        vendorName: settlement.employeeName,
        vendorEmail: '',
        vendorId: null,
        payeeEmployeeId: settlement.employee,
        billNumber,
        vendorInvoiceNumber: billNumber,
        billDate: today,
        dueDate: dueEndOfDay,
        paymentTerms: 'due_on_receipt',
        amount,
        department: 'hr',
        module: 'hr',
        referenceId: settlement._id,
        referenceType: 'final_settlement',
        lineDescription: `Final settlement — ${settlement.employeeName} (${settlement.employeeId})`,
        notes,
        createdBy,
        debitAccountNumber: SALARIES_EXPENSE,
        company: settlement.companyName || '',
        project: ''
      });
      await notifyFinance(settlement, bill, createdBy);
    }

    settlement.financeApBillId = bill._id;
    settlement.financeApBillNumber = bill.billNumber;
    settlement.financePostedAt = settlement.financePostedAt || new Date();
    settlement.financePostedBy = settlement.financePostedBy || createdBy;
    settlement.financePostError = undefined;
    settlement.workflowStatus = 'Pending Finance';
    await settlement.save();
    return { posted: true, billNumber: bill.billNumber };
  } catch (err) {
    console.error('postFinalSettlementToFinance failed:', err.message);
    settlement.financePostError = err.message;
    await settlement.save().catch(() => {});
    return { posted: false, error: err.message, statusCode: err.statusCode };
  }
};

/**
 * Recover the settlement's loan deduction from the employee's loans (called once, when Finance has paid).
 * The deduction is applied loan by loan (the loans saved on the settlement first, oldest first), each up to its
 * remaining balance: unpaid / paused installments are marked Paid oldest first, totals and balance updated,
 * and a loan recovered in full is Completed. Returns the per-loan lines for the settlement's `loans` array.
 */
const recoverSettlementLoans = async (settlement, userId) => {
  const Loan = require('../models/hr/Loan');
  const { getLoanRemainingBalance } = require('./loanPayrollDeduction');
  let toRecover = round2(settlement.deductions?.loanDeductions);
  if (toRecover <= 0) return { lines: settlement.loans || [], recovered: 0, note: 'No loan deduction on this settlement' };

  const savedIds = (settlement.loans || []).map((l) => l.loanId?._id || l.loanId).filter(Boolean).map(String);
  const loans = await Loan.find({
    employee: settlement.employee?._id || settlement.employee,
    status: { $in: ['Active', 'Disbursed', 'Defaulted'] }
  }).sort({ createdAt: 1 });
  loans.sort((a, b) => (savedIds.includes(String(b._id)) ? 1 : 0) - (savedIds.includes(String(a._id)) ? 1 : 0));

  const lines = [];
  const today = new Date();
  for (const loan of loans) {
    if (toRecover <= 0.009) break;
    const remaining = round2(getLoanRemainingBalance(loan));
    if (remaining <= 0.009) continue;
    const pay = round2(Math.min(toRecover, remaining));

    let left = pay;
    (loan.loanSchedule || [])
      .filter((i) => i.status !== 'Paid')
      .sort((a, b) => a.installmentNumber - b.installmentNumber)
      .forEach((inst) => {
        if (left <= 0.009) return;
        const amt = Number(inst.amount) || 0;
        if (left + 0.009 >= amt) {
          inst.status = 'Paid';
          inst.paymentDate = today;
          inst.paymentMethod = 'Salary Deduction';
          left = round2(left - amt);
        } else {
          inst.status = 'Partial';
          left = 0;
        }
      });

    loan.totalPaid = round2((Number(loan.totalPaid) || 0) + pay);
    loan.outstandingBalance = round2(Math.max(0, remaining - pay));
    if (loan.outstandingBalance <= 0.009) {
      loan.outstandingBalance = 0;
      loan.status = 'Completed';
      loan.completionDate = today;
    } else if (loan.status === 'Disbursed') {
      loan.status = 'Active';
    }
    if (userId) {
      loan.notes = loan.notes || [];
      loan.notes.push({
        content: `Recovered Rs ${pay.toLocaleString()} from final settlement ${settlement.financeApBillNumber || settlement._id} (paid by Finance)`,
        addedBy: userId
      });
    }
    await loan.save();

    toRecover = round2(toRecover - pay);
    lines.push({
      loanId: loan._id,
      loanType: loan.loanType,
      originalAmount: loan.loanAmount,
      outstandingBalance: remaining,
      settledAmount: pay,
      settlementType: pay + 0.009 >= remaining ? 'full_settlement' : 'partial_settlement'
    });
  }

  // Loans on the settlement that got nothing stay listed as pending
  (settlement.loans || []).forEach((l) => {
    const id = String(l.loanId?._id || l.loanId || '');
    if (id && !lines.some((x) => String(x.loanId) === id)) {
      lines.push({ ...(l.toObject ? l.toObject() : l), settledAmount: 0, settlementType: 'pending' });
    }
  });

  const recovered = round2(round2(settlement.deductions.loanDeductions) - toRecover);
  const note = toRecover > 0.009
    ? `Recovered Rs ${recovered.toLocaleString()} from loans; Rs ${toRecover.toLocaleString()} of the loan deduction had no open loan balance`
    : `Recovered Rs ${recovered.toLocaleString()} from ${lines.filter((l) => l.settledAmount > 0).length} loan(s)`;
  return { lines, recovered, note };
};

/**
 * Bring settlements in Finance up to date with their AP bill: fully paid → Paid; bill voided → back to
 * "Approved by CEO" so HR can resend. Accepts mongoose docs or lean objects (lean ones are updated in place
 * for the response and saved through updateOne).
 */
const syncFinalSettlementPayments = async (settlements = []) => {
  const list = (Array.isArray(settlements) ? settlements : [settlements])
    .filter((s) => s && s.financeApBillId
      && (s.workflowStatus === 'Pending Finance' || (s.workflowStatus === 'Paid' && !s.loansSettledAt)));
  if (!list.length) return;
  const ids = list.map((s) => s.financeApBillId._id || s.financeApBillId)
    .filter((id) => mongoose.Types.ObjectId.isValid(String(id)));
  const bills = await AccountsPayable.find({ _id: { $in: ids } })
    .select('status totalAmount duePaymentAmount amountPaid advanceApplied paymentPending advancePending approvalStatus updatedAt')
    .lean();
  const byId = new Map(bills.map((b) => [String(b._id), b]));
  const FinalSettlement = require('../models/hr/FinalSettlement');

  await Promise.all(list.map(async (s) => {
    const bill = byId.get(String(s.financeApBillId._id || s.financeApBillId));
    let set = null;
    let unset = null;
    if (!bill || bill.status === 'cancelled') {
      set = { workflowStatus: 'Approved by CEO', financePostError: 'Finance bill was voided — send to Finance again' };
      unset = { financeApBillId: 1, financeApBillNumber: 1, financePostedAt: 1 };
    } else if (getBillPayState(bill).balance <= 0.01) {
      set = { workflowStatus: 'Paid', status: 'paid', paidAt: bill.updatedAt || new Date(), processedDate: s.processedDate || bill.updatedAt || new Date() };
    }
    if (!set) return;
    if (set.workflowStatus === 'Paid') {
      // Claim the loan recovery atomically so two requests can't recover the same loans twice
      const claimed = await FinalSettlement.findOneAndUpdate(
        { _id: s._id, workflowStatus: { $in: ['Pending Finance', 'Paid'] }, loansSettledAt: { $exists: false } },
        { $set: { ...set, loansSettledAt: new Date() } },
        { new: true }
      );
      if (!claimed) return;
      try {
        const { lines, note } = await recoverSettlementLoans(claimed, claimed.financePostedBy || claimed.updatedBy);
        await FinalSettlement.updateOne({ _id: s._id }, { $set: { loans: lines, loanRecoveryNote: note } });
        Object.assign(s, set, { loans: lines, loanRecoveryNote: note, loansSettledAt: claimed.loansSettledAt });
      } catch (err) {
        console.error('Final settlement loan recovery failed:', err.message);
        // Release the claim so the next sync retries the recovery (settlement stays Paid)
        await FinalSettlement.updateOne({ _id: s._id }, { $unset: { loansSettledAt: 1 }, $set: { loanRecoveryNote: `Loan recovery failed: ${err.message}` } });
        Object.assign(s, set);
      }
      return;
    }
    await FinalSettlement.updateOne({ _id: s._id }, { $set: set, ...(unset ? { $unset: unset } : {}) });
    Object.assign(s, set);
    if (unset) Object.keys(unset).forEach((k) => { s[k] = undefined; });
  }));
};

module.exports = { postFinalSettlementToFinance, syncFinalSettlementPayments, settlementNumber };
