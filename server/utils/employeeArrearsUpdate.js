const Employee = require('../models/hr/Employee');

const ARREARS_TYPES = [
  'salaryAdjustment',
  'bonusPayment',
  'overtimePayment',
  'allowanceAdjustment',
  'deductionReversal',
  'other'
];

/**
 * Mark employee arrears for a payroll month/year as Paid without full employee.save()
 * (avoids re-validating unrelated fields such as spouseName).
 * @returns {Promise<boolean>} true when at least one arrears entry was updated
 */
const markEmployeeArrearsPaidForPeriod = async (employeeId, month, year) => {
  const employee = await Employee.findById(employeeId).select('employeeId arrears').lean();
  if (!employee?.arrears) return false;

  const paidAt = new Date();
  const update = {};
  let changed = false;

  for (const arrearsType of ARREARS_TYPES) {
    const arrearsData = employee.arrears[arrearsType];
    if (
      arrearsData?.isActive &&
      arrearsData.month === month &&
      arrearsData.year === year &&
      arrearsData.status !== 'Paid' &&
      arrearsData.status !== 'Cancelled'
    ) {
      update[`arrears.${arrearsType}.status`] = 'Paid';
      update[`arrears.${arrearsType}.paidDate`] = paidAt;
      changed = true;
    }
  }

  if (!changed) return false;

  await Employee.findByIdAndUpdate(employeeId, { $set: update }, { runValidators: false });
  return true;
};

/**
 * Undo markEmployeeArrearsPaidForPeriod when that month's Draft payroll is deleted, so regenerating the
 * month pays the arrears again instead of skipping them as already Paid.
 * Call only for a deleted payroll that carried arrears (payroll.arrears > 0).
 * @returns {Promise<boolean>} true when at least one arrears entry was put back to Pending
 */
const markEmployeeArrearsPendingForPeriod = async (employeeId, month, year) => {
  const m = Number(month);
  const y = Number(year);
  const employee = await Employee.findById(employeeId).select('employeeId arrears').lean();
  if (!employee?.arrears) return false;

  const set = {};
  for (const arrearsType of ARREARS_TYPES) {
    const arrearsData = employee.arrears[arrearsType];
    if (
      arrearsData?.isActive &&
      Number(arrearsData.month) === m &&
      Number(arrearsData.year) === y &&
      arrearsData.status === 'Paid'
    ) {
      set[`arrears.${arrearsType}.status`] = 'Pending';
    }
  }

  if (!Object.keys(set).length) return false;

  await Employee.findByIdAndUpdate(employeeId, { $set: set }, { runValidators: false });
  return true;
};

module.exports = {
  ARREARS_TYPES,
  markEmployeeArrearsPaidForPeriod,
  markEmployeeArrearsPendingForPeriod
};
