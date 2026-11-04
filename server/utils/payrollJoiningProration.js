const { prorateEmployeeAllowances } = require('./allowanceHelpers');

const getEmployeeJoiningDate = (employee) => {
  const raw = employee?.hireDate || employee?.appointmentDate;
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
};

/** Working days (Mon–Sat) from startDay through end of month; month is 1–12. */
const calculateWorkingDaysFromDay = (year, month, startDay = 1) => {
  const daysInMonth = new Date(year, month, 0).getDate();
  const fromDay = Math.max(1, Math.min(startDay, daysInMonth));
  let count = 0;
  for (let day = fromDay; day <= daysInMonth; day += 1) {
    if (new Date(year, month - 1, day).getDay() !== 0) {
      count += 1;
    }
  }
  return count;
};

/**
 * First payroll month: prorate by calendar days from joining date to month end.
 * Later months: full salary. Joining after payroll month: skip.
 */
const getJoiningProration = (month, year, joiningDate) => {
  const daysInMonth = new Date(year, month, 0).getDate();

  if (!joiningDate) {
    return {
      factor: 1,
      isProrated: false,
      skipPayroll: false,
      payableDays: daysInMonth,
      daysInMonth,
      workingDaysFromJoining: calculateWorkingDaysFromDay(year, month, 1)
    };
  }

  const joinYear = joiningDate.getFullYear();
  const joinMonth = joiningDate.getMonth() + 1;
  const joinDay = joiningDate.getDate();

  if (joinYear > year || (joinYear === year && joinMonth > month)) {
    return {
      factor: 0,
      isProrated: false,
      skipPayroll: true,
      payableDays: 0,
      daysInMonth,
      joiningDate,
      reason: 'Employee joining date is after this payroll period'
    };
  }

  if (joinYear < year || (joinYear === year && joinMonth < month)) {
    return {
      factor: 1,
      isProrated: false,
      skipPayroll: false,
      payableDays: daysInMonth,
      daysInMonth,
      joiningDate,
      workingDaysFromJoining: calculateWorkingDaysFromDay(year, month, 1)
    };
  }

  if (joinDay <= 1) {
    return {
      factor: 1,
      isProrated: false,
      skipPayroll: false,
      payableDays: daysInMonth,
      daysInMonth,
      joiningDate,
      workingDaysFromJoining: calculateWorkingDaysFromDay(year, month, 1)
    };
  }

  const payableDays = daysInMonth - joinDay + 1;
  const factor = payableDays / daysInMonth;

  return {
    factor,
    isProrated: true,
    skipPayroll: false,
    payableDays,
    daysInMonth,
    joiningDate,
    type: 'joining',
    workingDaysFromJoining: calculateWorkingDaysFromDay(year, month, joinDay),
    reason: `Prorated first salary: ${payableDays}/${daysInMonth} days from joining date`
  };
};

const formatJoiningDate = (date) =>
  date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

const buildProrationRemarksSuffix = (proration) => {
  if (!proration?.isProrated) return '';
  return ` (Prorated ${proration.payableDays}/${proration.daysInMonth} days from joining ${formatJoiningDate(proration.joiningDate)})`;
};

/**
 * Apply joining-date proration to monthly gross and employee allowances.
 */
const applyJoiningProration = (employee, month, year, monthlyGross) => {
  const joiningDate = getEmployeeJoiningDate(employee);
  const proration = getJoiningProration(month, year, joiningDate);

  if (proration.skipPayroll) {
    return { skipPayroll: true, proration, joiningDate };
  }

  if (proration.factor >= 1) {
    return {
      skipPayroll: false,
      proration,
      joiningDate,
      grossSalary: Math.round(Number(monthlyGross) || 0),
      allowances: employee?.allowances || {}
    };
  }

  const factor = proration.factor;
  return {
    skipPayroll: false,
    proration,
    joiningDate,
    grossSalary: Math.round((Number(monthlyGross) || 0) * factor),
    allowances: prorateEmployeeAllowances(employee?.allowances, factor)
  };
};

/** Adjust attendance snapshot for partial first month (salary already prorated). */
const adjustAttendanceForJoiningProration = (attendanceData, proration, proratedGross) => {
  if (!proration?.isProrated || !attendanceData) {
    return attendanceData;
  }

  // Partial pay: the salary is already cut to the days HR set as payable (e.g. 28/31 calendar days),
  // so those days are not absences. Comparing them with the month's working days (27) used to deduct
  // a fake absent day on top of the cut (Sidat pays the payable days only, no attendance deduction).
  if (proration.type === 'partial_salary') {
    const totalWorkingDays = attendanceData.totalWorkingDays;
    const presentDays = Math.min(attendanceData.presentDays ?? totalWorkingDays, totalWorkingDays);
    return {
      ...attendanceData,
      totalWorkingDays,
      presentDays,
      absentDays: 0,
      dailyRate: totalWorkingDays > 0 ? proratedGross / totalWorkingDays : 0,
      attendanceDeduction: 0
    };
  }

  const totalWorkingDays = proration.workingDaysFromJoining || attendanceData.totalWorkingDays;
  const presentDays = Math.min(attendanceData.presentDays ?? totalWorkingDays, totalWorkingDays);
  const leaveDays = Math.min(attendanceData.leaveDays || 0, totalWorkingDays);
  const absentDays = Math.max(0, totalWorkingDays - presentDays - leaveDays);
  const dailyRate = totalWorkingDays > 0 ? proratedGross / totalWorkingDays : 0;
  const attendanceDeduction = absentDays * dailyRate;

  return {
    ...attendanceData,
    totalWorkingDays,
    presentDays,
    absentDays,
    leaveDays,
    dailyRate,
    attendanceDeduction
  };
};

module.exports = {
  getEmployeeJoiningDate,
  getJoiningProration,
  calculateWorkingDaysFromDay,
  buildProrationRemarksSuffix,
  applyJoiningProration,
  adjustAttendanceForJoiningProration
};
