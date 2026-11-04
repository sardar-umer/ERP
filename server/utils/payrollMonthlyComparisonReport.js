const Payroll = require('../models/hr/Payroll');
const Employee = require('../models/hr/Employee');
const EmployeeIncrement = require('../models/hr/EmployeeIncrement');
const PayrollMonthlyComparisonReport = require('../models/hr/PayrollMonthlyComparisonReport');
const { syncComparisonReportStatusFromApproval } = require('./payrollAuthorityPayrollStatus');

const MONTH_NAMES = [
  '', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

const EMPLOYEE_REPORT_SELECT =
  'firstName lastName employeeId joiningDate hireDate appointmentDate createdAt terminationDate terminationReason employmentStatus placementDepartment department updatedAt isLateEntryForPayroll isLateTerminationEntryForPayroll salary';
const EMPLOYEE_POPULATE = [
  { path: 'placementDepartment', select: 'name' },
  { path: 'department', select: 'name' }
];

const prevPeriod = (month, year) => {
  if (month <= 1) return { month: 12, year: year - 1 };
  return { month: month - 1, year };
};

const monthRange = (month, year) => {
  const m = Number(month);
  const y = Number(year);
  const start = new Date(y, m - 1, 1, 0, 0, 0, 0);
  const end = new Date(y, m, 0, 23, 59, 59, 999);
  // Wide bounds to catch timezone offsets between UTC and local time
  const queryStart = new Date(Date.UTC(y, m - 1, 1, 0, 0, 0, 0) - 24 * 3600 * 1000);
  const queryEnd = new Date(Date.UTC(y, m, 0, 23, 59, 59, 999) + 24 * 3600 * 1000);
  return { start, end, queryStart, queryEnd };
};

const employeeName = (emp) =>
  [emp?.firstName, emp?.lastName].filter(Boolean).join(' ').trim() || emp?.employeeId || '—';

const employeeDepartment = (emp) =>
  emp?.placementDepartment?.name || emp?.department?.name || '—';

const mapEmployeeRow = (emp, extra = {}) => ({
  employeeId: emp?.employeeId || '—',
  name: employeeName(emp),
  department: employeeDepartment(emp),
  joiningDate: emp?.joiningDate || emp?.hireDate || emp?.appointmentDate || emp?.createdAt || null,
  terminationDate: emp?.terminationDate || null,
  employmentStatus: emp?.employmentStatus || '',
  reason: emp?.terminationReason || '',
  isLateEntryForPayroll: emp?.isLateEntryForPayroll || false,
  isLateTerminationEntryForPayroll: emp?.isLateTerminationEntryForPayroll || false,
  grossSalary: emp?.salary?.gross || 0,
  ...extra
});

const mapIncrementRow = (increment, empMap = new Map()) => {
  let emp = increment?.employee;
  if (!emp || typeof emp === 'string' || !emp.firstName) {
    const empIdStr = String(emp?._id || emp || '');
    if (empMap.has(empIdStr)) {
      emp = empMap.get(empIdStr);
    }
  }

  const prevSal = Number(increment?.previousSalary) || (emp?.salary?.gross ? Number(emp.salary.gross) - Number(increment?.incrementAmount || 0) : 0);
  const newSal = Number(increment?.newSalary) || (prevSal + Number(increment?.incrementAmount || 0));
  const incAmt = Number(increment?.incrementAmount) || (newSal - prevSal);
  const incPct = Number(increment?.incrementPercentage) || (prevSal > 0 ? Number(((incAmt / prevSal) * 100).toFixed(2)) : 0);
  const rawStatus = increment?.status || 'approved';
  const displayStatus = String(rawStatus).charAt(0).toUpperCase() + String(rawStatus).slice(1);

  return {
    employeeId: emp?.employeeId || (typeof increment?.employee === 'string' ? increment.employee : '—'),
    name: employeeName(emp),
    department: employeeDepartment(emp),
    incrementType: increment?.incrementType || 'annual',
    previousSalary: prevSal,
    newSalary: newSal,
    incrementAmount: incAmt,
    incrementPercentage: incPct,
    effectiveDate: increment?.effectiveDate || null,
    status: displayStatus,
    reason: increment?.reason || ''
  };
};

const { payrollExportGross } = require('./payrollExportGross');

const aggregatePayrollTotals = (payrolls = []) => {
  const totals = payrolls.reduce(
    (acc, row) => {
      // Same Gross as the monthly PDF / Excel export (Total Earn, full before any salary cut)
      acc.totalGrossSalary += payrollExportGross(row);
      // Match monthly CSV Net Payable: exclude attendance deduction from net
      acc.totalNetSalary +=
        (Number(row.netSalary) || 0) + (Number(row.attendanceDeduction) || 0);
      acc.totalBasicSalary += Number(row.basicSalary) || 0;
      return acc;
    },
    { totalGrossSalary: 0, totalNetSalary: 0, totalBasicSalary: 0 }
  );
  return {
    payrollCount: payrolls.length,
    ...totals
  };
};

const uniqueEmployeesById = (rows = []) => {
  const map = new Map();
  rows.forEach((row) => {
    const id = String(row?.employee?._id || row?.employee || '');
    if (!id) return;
    if (!map.has(id)) map.set(id, row);
  });
  return [...map.values()];
};

const isDateInMonth = (dateVal, m, y, createdAt = null) => {
  if (!dateVal) return false;
  const targetM = Number(m);
  const targetY = Number(y);

  if (dateVal instanceof Date && !Number.isNaN(dateVal.getTime())) {
    const utcM = dateVal.getUTCMonth() + 1;
    const utcY = dateVal.getUTCFullYear();
    const locM = dateVal.getMonth() + 1;
    const locY = dateVal.getFullYear();
    const utcDay = dateVal.getUTCDate();
    const locDay = dateVal.getDate();

    if ((utcM === targetM && utcY === targetY) || (locM === targetM && locY === targetY)) {
      return true;
    }

    // Inverted DD/MM vs MM/DD match (e.g. 1/8/2026 was saved as Month 1, Day 8)
    if ((utcDay === targetM && utcM === 1 && utcY === targetY) || (locDay === targetM && locM === 1 && locY === targetY)) {
      return true;
    }
  }

  const str = String(dateVal).trim();
  if (!str) return false;

  const parsedDate = new Date(str);
  if (!Number.isNaN(parsedDate.getTime())) {
    const utcM = parsedDate.getUTCMonth() + 1;
    const utcY = parsedDate.getUTCFullYear();
    const locM = parsedDate.getMonth() + 1;
    const locY = parsedDate.getFullYear();
    const utcDay = parsedDate.getUTCDate();
    const locDay = parsedDate.getDate();
    if ((utcM === targetM && utcY === targetY) || (locM === targetM && locY === targetY)) {
      return true;
    }
    if ((utcDay === targetM && utcM === 1 && utcY === targetY) || (locDay === targetM && locM === 1 && locY === targetY)) {
      return true;
    }
  }

  // Fallback for custom formatted strings like "1/8/2026", "01/08/2026", "2026-08-01", etc.
  const parts = str.split(/[\/\-\.T\s]/).filter(Boolean);
  if (parts.length >= 3) {
    let partY = null;
    let partM = null;
    if (parts[0].length === 4) {
      partY = parseInt(parts[0], 10);
      partM = parseInt(parts[1], 10);
    } else if (parts[2].length === 4) {
      partY = parseInt(parts[2], 10);
      const p0 = parseInt(parts[0], 10);
      const p1 = parseInt(parts[1], 10);
      if (p1 === targetM || p0 === targetM) {
        partM = targetM;
      }
    }
    if (partY === targetY && partM === targetM) {
      return true;
    }
  }

  return false;
};

const buildPayrollMonthlyComparisonReport = async (month, year) => {
  const prev = prevPeriod(month, year);
  const { start, end, queryStart, queryEnd } = monthRange(month, year);

  const SalaryAdvance = require('../models/hr/SalaryAdvance');

  const [currentPayrolls, previousPayrolls, currentAdvances, previousAdvances, hirings, separationsByDate, rawSalaryIncrements] = await Promise.all([
    Payroll.find({ month, year })
      .populate({ path: 'employee', select: EMPLOYEE_REPORT_SELECT, populate: EMPLOYEE_POPULATE })
      .lean(),
    Payroll.find({ month: prev.month, year: prev.year })
      .populate({ path: 'employee', select: EMPLOYEE_REPORT_SELECT, populate: EMPLOYEE_POPULATE })
      .lean(),
    SalaryAdvance.find({ payrollMonth: Number(month), payrollYear: Number(year) })
      .populate({ path: 'employee', select: EMPLOYEE_REPORT_SELECT, populate: EMPLOYEE_POPULATE })
      .lean(),
    SalaryAdvance.find({ payrollMonth: Number(prev.month), payrollYear: Number(prev.year) })
      .populate({ path: 'employee', select: EMPLOYEE_REPORT_SELECT, populate: EMPLOYEE_POPULATE })
      .lean(),
    Employee.find({
      $or: [
        { joiningDate: { $gte: start, $lte: end } },
        { hireDate: { $gte: start, $lte: end } },
        { appointmentDate: { $gte: start, $lte: end } },
        { createdAt: { $gte: start, $lte: end } },
        { isLateEntryForPayroll: true }
      ]
    })
      .select(EMPLOYEE_REPORT_SELECT)
      .populate(EMPLOYEE_POPULATE)
      .sort({ joiningDate: 1, hireDate: 1, appointmentDate: 1, createdAt: 1 })
      .lean(),
    Employee.find({
      $or: [
        { terminationDate: { $gte: queryStart, $lte: queryEnd } },
        { terminationDate: { $gte: start, $lte: end } }
      ],
      employmentStatus: { $nin: ['Active', 'Reinstated'] }
    })
      .select(EMPLOYEE_REPORT_SELECT)
      .populate(EMPLOYEE_POPULATE)
      .sort({ terminationDate: 1 })
      .lean(),
    EmployeeIncrement.find({
      status: { $nin: ['rejected', 'Rejected'] }
    })
      .populate({
        path: 'employee',
        select: EMPLOYEE_REPORT_SELECT,
        populate: EMPLOYEE_POPULATE
      })
      .sort({ effectiveDate: 1, createdAt: -1 })
      .lean()
  ]);

  const salaryIncrements = (rawSalaryIncrements || []).filter((inc) =>
    isDateInMonth(inc?.effectiveDate, month, year, inc?.createdAt)
  );

  const currentUnique = uniqueEmployeesById(currentPayrolls);
  const previousUnique = uniqueEmployeesById(previousPayrolls);

  const currentIdSet = new Set(
    currentUnique.map((p) => String(p.employee?._id || p.employee))
  );
  const previousIdSet = new Set(
    previousUnique.map((p) => String(p.employee?._id || p.employee))
  );

  const addedIds = [...currentIdSet].filter((id) => id && !previousIdSet.has(id));
  const removedIds = [...previousIdSet].filter((id) => id && !currentIdSet.has(id));

  const [addedEmployees, removedEmployees] = await Promise.all([
    addedIds.length
      ? Employee.find({ _id: { $in: addedIds } })
        .select(EMPLOYEE_REPORT_SELECT)
        .populate(EMPLOYEE_POPULATE)
        .lean()
      : [],
    removedIds.length
      ? Employee.find({ _id: { $in: removedIds } })
        .select(EMPLOYEE_REPORT_SELECT)
        .populate(EMPLOYEE_POPULATE)
        .lean()
      : []
  ]);

  const separationMap = new Map();
  (separationsByDate || []).forEach((emp) => {
    // 1. Exclude Active and Reinstated employees
    if (emp?.employmentStatus === 'Active' || emp?.employmentStatus === 'Reinstated') return;
    // 2. Only include if terminationDate falls strictly in this month & year
    if (!isDateInMonth(emp?.terminationDate, month, year)) return;
    separationMap.set(String(emp._id), mapEmployeeRow(emp));
  });

  (removedEmployees || []).forEach((emp) => {
    // Exclude Active and Reinstated employees from separations
    if (emp?.employmentStatus === 'Active' || emp?.employmentStatus === 'Reinstated') return;
    // Only include in separations if their termination date falls in this month & year
    if (!isDateInMonth(emp?.terminationDate, month, year)) return;
    const id = String(emp._id);
    if (!separationMap.has(id)) {
      separationMap.set(id, mapEmployeeRow(emp));
    }
  });

  const current = aggregatePayrollTotals(currentUnique);
  const previous = aggregatePayrollTotals(previousUnique);
  
  // If previous month has payroll records, compare directly.
  // If previous month has no payroll records, calculate net change from this month's hirings & separations
  // so it accurately reflects actual workforce movements rather than comparing against 0.
  const hasPreviousPayrolls = previous.payrollCount > 0;
  const netHiringSeparationChange = (hirings.length + addedEmployees.length) - (separationMap.size);
  const headcountChange = hasPreviousPayrolls
    ? current.payrollCount - previous.payrollCount
    : (current.payrollCount > 0 ? (hirings.length - separationMap.size) : 0);

  const headcountChangePercent = hasPreviousPayrolls
    ? Math.round((headcountChange / previous.payrollCount) * 1000) / 10
    : (current.payrollCount > 0 && headcountChange !== 0
        ? Math.round((headcountChange / Math.max(1, current.payrollCount - headcountChange)) * 1000) / 10
        : 0);

  const reinstatedEmployees = [];
  const reinstatedSeen = new Set();

  currentUnique.forEach((row) => {
    const emp = row.employee;
    if (!emp?._id || emp.employmentStatus !== 'Reinstated') return;

    const id = String(emp._id);
    if (reinstatedSeen.has(id)) return;

    const returnedToPayroll = !previousIdSet.has(id);
    const updatedAt = emp.updatedAt ? new Date(emp.updatedAt) : null;
    const statusUpdatedThisMonth = updatedAt
      && !Number.isNaN(updatedAt.getTime())
      && updatedAt >= start
      && updatedAt <= end;

    // Only include in reinstated table if the employee newly RETURNED to payroll this month
    // (i.e. was on current month payroll but NOT on previous month payroll)
    if (!returnedToPayroll) return;

    reinstatedSeen.add(id);
    reinstatedEmployees.push(mapEmployeeRow(emp, {
      note: emp.reinstatedReason || 'Employee reinstated on payroll this month',
      employmentStatus: 'Reinstated'
    }));
  });

  const hiringMap = new Map();
  (hirings || []).forEach((emp) => {
    const id = String(emp._id);
    if (emp?.employmentStatus === 'Reinstated' || reinstatedSeen.has(id)) return;
    const joinDate = emp?.joiningDate || emp?.hireDate || emp?.appointmentDate;
    if (isDateInMonth(joinDate, month, year) || isDateInMonth(emp?.createdAt, month, year) || emp?.isLateEntryForPayroll) {
      hiringMap.set(id, mapEmployeeRow(emp));
    }
  });
  (addedEmployees || []).forEach((emp) => {
    const id = String(emp._id);
    if (emp?.employmentStatus === 'Reinstated' || reinstatedSeen.has(id)) return;
    const joinDate = emp?.joiningDate || emp?.hireDate || emp?.appointmentDate;
    if (isDateInMonth(joinDate, month, year) || isDateInMonth(emp?.createdAt, month, year) || emp?.isLateEntryForPayroll) {
      if (!hiringMap.has(id)) {
        hiringMap.set(id, mapEmployeeRow(emp, { note: 'Added to payroll this month' }));
      }
    }
  });

  return {
    month,
    year,
    periodLabel: `${MONTH_NAMES[month]} ${year}`,
    previousPeriod: {
      month: prev.month,
      year: prev.year,
      label: `${MONTH_NAMES[prev.month]} ${prev.year}`
    },
    current,
    previous,
    comparison: {
      headcountChange,
      headcountChangePercent,
      grossSalaryChange: current.totalGrossSalary - previous.totalGrossSalary,
      netSalaryChange: current.totalNetSalary - previous.totalNetSalary
    },
    salaryAdvances: {
      current: {
        count: currentAdvances.length,
        totalAmount: currentAdvances.reduce((sum, a) => sum + (a.amount || 0), 0),
        items: currentAdvances.map(a => ({
          employeeId: a.employee?.employeeId || '—',
          name: employeeName(a.employee),
          department: employeeDepartment(a.employee),
          amount: a.amount || 0,
          paymentMethod: a.paymentMethod || 'Bank Transfer',
          status: a.status || 'Unadjusted',
          reason: a.reason || ''
        }))
      },
      previous: {
        count: previousAdvances.length,
        totalAmount: previousAdvances.reduce((sum, a) => sum + (a.amount || 0), 0)
      }
    },
    hirings: [...hiringMap.values()],
    separations: [...separationMap.values()],
    salaryIncrements: salaryIncrements.map((row) => mapIncrementRow(row)),
    reinstatedEmployees,
    newOnPayroll: addedEmployees.map((emp) => mapEmployeeRow(emp, { note: 'Added to payroll vs last month' })),
    removedFromPayroll: removedEmployees.map((emp) => mapEmployeeRow(emp, { note: 'On last month payroll, not this month' }))
  };
};

const LOCKED_STATUSES = ['Approved', 'Approved by AVP'];

const savePayrollMonthlyComparisonReport = async (month, year, actorId, { force = false } = {}) => {
  const existingDoc = await PayrollMonthlyComparisonReport.findOne({ month, year });
  // Only lock if the report has reached a FINAL approval status AND force is not requested
  if (!force && existingDoc && existingDoc.report && LOCKED_STATUSES.includes(existingDoc.status)) {
    console.log(`🔒 Returning locked Monthly Comparison Report for ${month}/${year} (status: ${existingDoc.status})`);
    return {
      report: existingDoc.report,
      savedAt: existingDoc.generatedAt,
      status: existingDoc.status,
      _id: existingDoc._id
    };
  }
  // Draft or intermediate-approval reports regenerate with fresh data
  const report = await buildPayrollMonthlyComparisonReport(month, year);
  const mongoose = require('mongoose');
  const updateFields = {
    month,
    year,
    report,
    generatedAt: new Date()
  };
  if (actorId && mongoose.Types.ObjectId.isValid(actorId)) {
    updateFields.generatedBy = actorId;
  }
  const doc = await PayrollMonthlyComparisonReport.findOneAndUpdate(
    { month, year },
    updateFields,
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  await syncComparisonReportStatusFromApproval(month, year);
  const refreshed = await PayrollMonthlyComparisonReport.findById(doc._id).lean();
  return {
    report: refreshed?.report || report,
    savedAt: refreshed?.generatedAt || doc.generatedAt,
    status: refreshed?.status || doc.status || 'Draft',
    _id: doc._id
  };
};

const formatComparisonDocResponse = (doc) => ({
  report: doc.report,
  generatedAt: doc.generatedAt,
  status: doc.status || 'Draft',
  approvedAt: doc.approvedAt || null,
  fromCache: true,
  _id: doc._id
});

const getPayrollMonthlyComparisonReport = async (month, year, { regenerate = false } = {}) => {
  if (!regenerate) {
    const existing = await PayrollMonthlyComparisonReport.findOne({ month, year }).lean();
    // Only return cached report if it has been locked with final approval
    if (existing?.report && LOCKED_STATUSES.includes(existing.status)) {
      return formatComparisonDocResponse(existing);
    }
  }
  const payrollCount = await Payroll.countDocuments({ month, year });
  if (!payrollCount) {
    const err = new Error('No payroll records found for this month. Generate payroll first.');
    err.statusCode = 404;
    throw err;
  }
  const built = await buildPayrollMonthlyComparisonReport(month, year);
  return { report: built, status: 'Draft', fromCache: false };
};

/**
 * After a comparison report is saved for a month, clear the late-entry / late-termination
 * flags on employees so they don't bleed into future months' comparison reports.
 *
 * Only clears flags for employees who appear on the current month's payroll (late entries)
 * or who were captured in the separations section (late terminations).
 */
const clearLateEntryFlags = async (month, year) => {
  // Do NOT clear late entry / late termination flags automatically.
  // Flags are preserved as set by HR / Admin.
};

module.exports = {
  MONTH_NAMES,
  buildPayrollMonthlyComparisonReport,
  savePayrollMonthlyComparisonReport,
  getPayrollMonthlyComparisonReport,
  clearLateEntryFlags
};
