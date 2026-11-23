const Payroll = require('../models/hr/Payroll');
const PayrollMonthlyComparisonReport = require('../models/hr/PayrollMonthlyComparisonReport');
const { PAYROLL_AUTHORITY_SLOT_CONFIG, getApprovedAuthorityKeys, isFinalPayrollAuthoritySlot } = require('./payrollMonthlyApproval');
const { markEmployeeArrearsPaidForPeriod } = require('./employeeArrearsUpdate');

const PAYROLL_STATUS_BY_AUTHORITY_SLOT = {
  accountsOfficerUser: 'Approved by Deputy Manager Payroll HR',
  financeControllerUser: 'Approved by GM HR'
};

const PAYROLL_AUTHORITY_APPROVAL_STATUSES = Object.values(PAYROLL_STATUS_BY_AUTHORITY_SLOT);

// 'Approved by GM HR' is final since AVP left the chain; 'Approved by AVP' stays for older months.
const PAYROLL_FINAL_APPROVED_STATUSES = ['Approved', 'Approved by GM HR', 'Approved by AVP'];

const isPayrollFinalApprovedStatus = (status) =>
  PAYROLL_FINAL_APPROVED_STATUSES.includes(String(status || '').trim());

const eligibleStatusesForAuthoritySlot = (slotKey) => {
  const order = PAYROLL_AUTHORITY_SLOT_CONFIG.map((slot) => slot.key);
  const idx = order.indexOf(slotKey);
  if (idx < 0) return [];
  const statuses = ['Draft'];
  for (let i = 0; i < idx; i += 1) {
    const priorStatus = PAYROLL_STATUS_BY_AUTHORITY_SLOT[order[i]];
    if (priorStatus) statuses.push(priorStatus);
  }
  return statuses;
};

const applyBulkPayrollStatusForAuthoritySlot = async (month, year, slotKey, actorId) => {
  const newStatus = PAYROLL_STATUS_BY_AUTHORITY_SLOT[slotKey];
  if (!newStatus) {
    return { matched: 0, modified: 0, payrollIds: [] };
  }

  const eligibleStatuses = eligibleStatusesForAuthoritySlot(slotKey);
  const payrolls = await Payroll.find({
    month,
    year,
    status: { $in: eligibleStatuses }
  }).select('_id arrears employee');

  if (!payrolls.length) {
    return { matched: 0, modified: 0, payrollIds: [] };
  }

  const payrollIds = payrolls.map((p) => p._id);
  const update = { status: newStatus };
  if (isFinalPayrollAuthoritySlot(slotKey)) {
    update.approvedBy = actorId;
    update.approvedAt = new Date();
  }

  const result = await Payroll.updateMany(
    { _id: { $in: payrollIds } },
    { $set: update }
  );

  if (isFinalPayrollAuthoritySlot(slotKey)) {
    for (const payroll of payrolls) {
      if (Number(payroll.arrears) > 0) {
        await markEmployeeArrearsPaidForPeriod(payroll.employee, month, year);
      }
    }
  }

  return {
    matched: result.matchedCount ?? payrolls.length,
    modified: result.modifiedCount ?? payrolls.length,
    payrollIds
  };
};

const applyComparisonReportStatusForAuthoritySlot = async (month, year, slotKey, actorId) => {
  const newStatus = PAYROLL_STATUS_BY_AUTHORITY_SLOT[slotKey];
  if (!newStatus) {
    return { matched: 0, modified: 0 };
  }

  const comparisonDoc = await PayrollMonthlyComparisonReport.findOne({ month, year });
  if (!comparisonDoc) {
    return { matched: 0, modified: 0 };
  }

  const eligibleStatuses = eligibleStatusesForAuthoritySlot(slotKey);
  if (!eligibleStatuses.includes(comparisonDoc.status)) {
    return { matched: 1, modified: 0 };
  }

  const update = { status: newStatus };
  if (isFinalPayrollAuthoritySlot(slotKey)) {
    update.approvedBy = actorId;
    update.approvedAt = new Date();
  }

  await PayrollMonthlyComparisonReport.updateOne(
    { _id: comparisonDoc._id },
    { $set: update }
  );

  return { matched: 1, modified: 1 };
};

const syncComparisonReportStatusFromApproval = async (month, year) => {
  const comparisonDoc = await PayrollMonthlyComparisonReport.findOne({ month, year });
  if (!comparisonDoc) return null;

  const PayrollMonthlyApproval = require('../models/hr/PayrollMonthlyApproval');
  const approval = await PayrollMonthlyApproval.findOne({ month, year });
  if (!approval) {
    comparisonDoc.status = 'Draft';
    comparisonDoc.approvedBy = undefined;
    comparisonDoc.approvedAt = undefined;
    await comparisonDoc.save();
    return comparisonDoc;
  }

  const approvedKeys = getApprovedAuthorityKeys(approval);
  let status = 'Draft';
  let approvedBy;
  let approvedAt;

  PAYROLL_AUTHORITY_SLOT_CONFIG.forEach((slot) => {
    if (approvedKeys.has(slot.key)) {
      status = PAYROLL_STATUS_BY_AUTHORITY_SLOT[slot.key];
      if (isFinalPayrollAuthoritySlot(slot.key)) {
        const record = (approval.financeAuthorityApprovals || []).find(
          (row) => row.authorityKey === slot.key && String(row?.decision || 'approved') !== 'rejected'
        );
        approvedBy = record?.approver;
        approvedAt = record?.approvedAt;
      }
    }
  });

  comparisonDoc.status = status;
  comparisonDoc.approvedBy = approvedBy || undefined;
  comparisonDoc.approvedAt = approvedAt || undefined;
  await comparisonDoc.save();
  return comparisonDoc;
};

module.exports = {
  PAYROLL_STATUS_BY_AUTHORITY_SLOT,
  PAYROLL_AUTHORITY_APPROVAL_STATUSES,
  PAYROLL_FINAL_APPROVED_STATUSES,
  isPayrollFinalApprovedStatus,
  eligibleStatusesForAuthoritySlot,
  applyBulkPayrollStatusForAuthoritySlot,
  applyComparisonReportStatusForAuthoritySlot,
  syncComparisonReportStatusFromApproval
};
