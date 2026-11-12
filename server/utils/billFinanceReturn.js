/**
 * Finance return of a vendor bill to its initiator ("Returned from Finance").
 * Department approvalChain / approvalStatus stay intact: after the initiator edits and
 * resubmits, the bill goes straight back to Finance (status "approved") with no re-approval.
 */

const RETURNABLE_STATUSES = ['approved', 'received', 'overdue'];

const num = (v) => Number(v) || 0;

/** Why a bill cannot be returned right now (null when it can). */
const getBillReturnBlocker = (bill) => {
  if (!bill) return 'Bill not found';
  if (!RETURNABLE_STATUSES.includes(bill.status)) {
    return 'Only approved vendor bills (awaiting payment) can be returned to the initiator';
  }
  const paid = num(bill.amountPaid ?? bill.paidAmount);
  const advanceApplied = num(bill.advanceApplied);
  const settlementPending = num(
    bill.settlementPending ?? (num(bill.advancePending) + num(bill.paymentPending))
  );
  if (paid + advanceApplied > 0 || settlementPending > 0) {
    return 'Cannot return a bill that already has payment / advance settlement recorded or pending';
  }
  return null;
};

/**
 * Move the bill to "Returned from Finance", record history + observation, notify the initiator.
 * Caller must check getBillReturnBlocker first. Saves the bill.
 */
const returnBillToInitiator = async (bill, { userId, reason, historyComment }) => {
  const fromStatus = bill.status;
  const now = new Date();
  bill.workflowHistory = Array.isArray(bill.workflowHistory) ? bill.workflowHistory : [];
  bill.workflowHistory.push({
    fromStatus,
    toStatus: 'Returned from Finance',
    changedBy: userId,
    changedAt: now,
    comments: historyComment || `Returned to initiator: ${reason}`,
    module: 'Finance'
  });
  bill.observations = Array.isArray(bill.observations) ? bill.observations : [];
  bill.observations.push({
    observation: reason,
    severity: 'medium',
    addedBy: userId,
    addedAt: now,
    resolved: false
  });
  bill.status = 'Returned from Finance';
  bill.lastModifiedBy = userId;
  await bill.save();

  // A bill posted from a utility bill: its initiator works on the utility bill, so return that too.
  // The AP bill's createdBy is whoever posted it to Finance (e.g. the Audit Director), not the initiator —
  // the person who entered the utility bill is.
  let initiatorId = bill.createdBy ? String(bill.createdBy._id || bill.createdBy) : null;
  if (bill.referenceType === 'utility_bill') {
    try {
      const ub = await markUtilityBillReturned(bill, { userId, reason, now });
      if (ub?.createdBy) initiatorId = String(ub.createdBy._id || ub.createdBy);
    } catch (ubErr) {
      console.warn('finance-return: could not mark source utility bill:', ubErr.message);
    }
  }

  try {
    if (initiatorId) {
      const { createAndEmitNotification } = require('../services/realtimeNotificationService');
      await createAndEmitNotification({
        recipientIds: [initiatorId],
        title: 'Vendor bill returned by Finance',
        message: `Bill ${bill.billNumber || bill._id} was returned for correction: ${reason}`,
        type: 'warning',
        category: 'approval',
        priority: 'high',
        // Utility-bill initiators correct the bill on the centralized store bill page
        actionUrl: bill.referenceType === 'utility_bill' && bill.referenceId
          ? `/general/centralized-store/bills/${bill.referenceId}`
          : '/finance/accounts-payable',
        createdBy: userId,
        excludeUserId: userId,
        metadata: {
          module: 'finance',
          entityId: bill._id,
          entityType: 'AccountsPayable',
          queueStage: 'returned_from_finance'
        }
      });
    }
  } catch (notifyErr) {
    console.warn('finance-return notify warning:', notifyErr.message);
  }

  return bill;
};

/** Show the Finance return on the source utility bill (status + observation) so its initiator can correct it */
const markUtilityBillReturned = async (apBill, { userId, reason, now = new Date() }) => {
  const UtilityBill = require('../models/hr/UtilityBill');
  const ub = await UtilityBill.findOne({
    $or: [{ financeApBillId: apBill._id }, ...(apBill.referenceId ? [{ _id: apBill.referenceId }] : [])]
  });
  if (!ub) return null;
  ub.financeReturn = { active: true, reason, returnedBy: userId, returnedAt: now, resubmittedBy: null, resubmittedAt: null };
  ub.observations = Array.isArray(ub.observations) ? ub.observations : [];
  ub.observations.push({ observation: reason, severity: 'medium', addedBy: userId, addedAt: now, resolved: false });
  ub.workflowHistory = Array.isArray(ub.workflowHistory) ? ub.workflowHistory : [];
  ub.workflowHistory.push({
    fromStatus: ub.auditStatus,
    toStatus: 'Returned from Finance',
    changedBy: userId,
    changedAt: now,
    comments: `Returned by Finance for correction: ${reason}`,
    module: 'finance'
  });
  ub.updatedBy = userId;
  await ub.save();
  return ub;
};

module.exports = { getBillReturnBlocker, returnBillToInitiator, markUtilityBillReturned, RETURNABLE_STATUSES };
