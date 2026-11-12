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

  try {
    const initiatorId = bill.createdBy ? String(bill.createdBy._id || bill.createdBy) : null;
    if (initiatorId) {
      const { createAndEmitNotification } = require('../services/realtimeNotificationService');
      await createAndEmitNotification({
        recipientIds: [initiatorId],
        title: 'Vendor bill returned by Finance',
        message: `Bill ${bill.billNumber || bill._id} was returned for correction: ${reason}`,
        type: 'warning',
        category: 'approval',
        priority: 'high',
        actionUrl: '/finance/accounts-payable',
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

module.exports = { getBillReturnBlocker, returnBillToInitiator, RETURNABLE_STATUSES };
