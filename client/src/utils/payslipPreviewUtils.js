import { vehicleAllowanceAmount, fuelAllowanceAmount } from './allowanceHelpers';

const MONTH_NAMES = [
  '',
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December'
];

export const getEmployeeDepartmentLabel = (employee = {}) =>
  employee.placementDepartment?.name ||
  employee.department?.name ||
  (typeof employee.department === 'string' ? employee.department : '') ||
  '—';

export const getEmployeePositionLabel = (employee = {}) =>
  employee.placementDesignation?.title ||
  employee.placementDesignation?.name ||
  (typeof employee.placementDesignation === 'string' ? employee.placementDesignation : '') ||
  employee.position?.title ||
  (typeof employee.position === 'string' ? employee.position : '') ||
  '—';

export const getMonthName = (month) => {
  const m = Number(month);
  if (!m || m < 1 || m > 12) return '';
  return MONTH_NAMES[m] || `Month ${m}`;
};

export const formatPayslipEmployeeId = (employeeId) => {
  if (employeeId == null || employeeId === '') return '—';
  return String(employeeId).padStart(5, '0');
};

/**
 * Build in-app payslip preview data from employee + payroll/currentPayroll snapshot.
 */
export const buildPayslipPreviewData = ({
  employee,
  payroll,
  month,
  year,
  loanDeductions = 0,
  advanceLeaveDeduction = 0,
  totalDeductions,
  netSalary
}) => {
  const payrollMonth = month ?? payroll?.month ?? new Date().getMonth() + 1;
  const payrollYear = year ?? payroll?.year ?? new Date().getFullYear();
  const formattedId = formatPayslipEmployeeId(employee?.employeeId);

  const earnings = {
    basicSalary: payroll?.basicSalary || 0,
    houseRent: payroll?.houseRentAllowance || 0,
    medicalAllowance: payroll?.medicalAllowance || 0,
    conveyanceAllowance: payroll?.allowances?.conveyance?.amount || 0,
    foodAllowance: payroll?.allowances?.food?.amount || 0,
    mobileAllowance: payroll?.allowances?.mobile?.amount || 0,
    vehicleAllowance: vehicleAllowanceAmount(payroll?.allowances),
    fuelAllowance: fuelAllowanceAmount(payroll?.allowances),
    medicalFromAllowances: payroll?.allowances?.medical?.amount || 0,
    houseRentFromAllowances: payroll?.allowances?.houseRent?.amount || 0,
    specialAllowance: payroll?.allowances?.special?.amount || 0,
    otherAllowances: payroll?.allowances?.other?.amount || 0,
    overtime: payroll?.overtimeAmount || 0,
    bonus: payroll?.performanceBonus || 0,
    otherBonus: payroll?.otherBonus || 0,
    arrears: payroll?.arrears || 0
  };

  const deductions = {
    eobi: payroll?.eobi ?? 0,
    incomeTax: payroll?.incomeTax ?? payroll?.monthlyTax ?? 0,
    providentFund: payroll?.providentFund || 0,
    healthInsurance: payroll?.healthInsurance || 0,
    loanDeductions: payroll?.loanDeductions ?? loanDeductions,
    attendanceDeduction: payroll?.attendanceDeduction || 0,
    leaveDeduction: (payroll?.leaveDeduction || 0) + advanceLeaveDeduction,
    otherDeductions: payroll?.otherDeductions || 0
  };

  const totalEarnings = payroll?.totalEarnings || 0;
  const computedTotalDeductions =
    totalDeductions ??
    deductions.incomeTax +
      deductions.eobi +
      deductions.healthInsurance +
      deductions.loanDeductions +
      deductions.attendanceDeduction +
      deductions.leaveDeduction +
      deductions.otherDeductions +
      deductions.providentFund;

  const computedNet = netSalary ?? totalEarnings - computedTotalDeductions;

  return {
    employee: {
      firstName: employee?.firstName || '',
      lastName: employee?.lastName || '',
      employeeId: formattedId,
      department: getEmployeeDepartmentLabel(employee),
      designation: getEmployeePositionLabel(employee)
    },
    period: {
      month: payrollMonth,
      year: payrollYear,
      monthName: getMonthName(payrollMonth)
    },
    payslipNumber: `PS${payrollYear}${String(payrollMonth).padStart(2, '0')}${formattedId}`,
    issueDate: new Date().toLocaleDateString('en-PK'),
    earnings,
    deductions,
    attendance: {
      totalDays: payroll?.totalWorkingDays || 26,
      presentDays: payroll?.presentDays ?? payroll?.totalWorkingDays ?? 26,
      absentDays: payroll?.absentDays || 0,
      leaveDays: payroll?.leaveDays || 0
    },
    totals: {
      grossSalary: totalEarnings,
      totalDeductions: computedTotalDeductions,
      netSalary: computedNet
    },
    proration: payroll?.proration,
    remarks: payroll?.remarks
  };
};

/** Payload for POST /api/payslips from a payroll record. */
export const buildPayslipCreatePayload = ({ employee, payroll, notes }) => {
  const preview = buildPayslipPreviewData({ employee, payroll });
  const { earnings, deductions, attendance, period } = preview;

  return {
    employeeId: employee.employeeId,
    month: period.month,
    year: period.year,
    earnings: {
      basicSalary: earnings.basicSalary,
      houseRent: earnings.houseRent,
      medicalAllowance: earnings.medicalAllowance,
      conveyanceAllowance: earnings.conveyanceAllowance,
      specialAllowance: earnings.specialAllowance,
      otherAllowances:
        earnings.otherAllowances +
        earnings.foodAllowance +
        (earnings.mobileAllowance || 0) +
        earnings.vehicleAllowance +
        earnings.fuelAllowance +
        earnings.medicalFromAllowances +
        earnings.houseRentFromAllowances,
      overtime: earnings.overtime,
      bonus: earnings.bonus,
      incentives: earnings.otherBonus,
      arrears: earnings.arrears,
      otherEarnings: 0
    },
    deductions: {
      providentFund: deductions.providentFund,
      eobi: deductions.eobi,
      incomeTax: deductions.incomeTax,
      loanDeduction: deductions.loanDeductions,
      advanceDeduction: deductions.advanceSalary || payroll?.advanceSalary || 0,
      lateDeduction: 0,
      absentDeduction: deductions.attendanceDeduction,
      otherDeductions: deductions.leaveDeduction + deductions.otherDeductions
    },
    attendance: {
      totalDays: attendance.totalDays,
      presentDays: attendance.presentDays,
      absentDays: attendance.absentDays,
      lateDays: 0,
      overtimeHours: payroll?.overtimeHours || 0
    },
    notes:
      notes ||
      `Generated from payroll for ${period.monthName} ${period.year}`
  };
};

/** Map in-app preview data to the server payslip PDF payload shape. */
export const previewToPayslipPdfPayload = (preview = {}) => {
  const { employee, period, earnings, deductions, attendance, totals, payslipNumber, remarks } =
    preview;

  const otherAllowances =
    (earnings?.otherAllowances || 0) +
    (earnings?.medicalFromAllowances || 0) +
    (earnings?.houseRentFromAllowances || 0);

  return {
    payslipNumber,
    employeeName: `${employee?.firstName || ''} ${employee?.lastName || ''}`.trim(),
    employeeId: employee?.employeeId,
    department: employee?.department || '—',
    designation: employee?.designation || '—',
    month: period?.month,
    year: period?.year,
    earnings: {
      basicSalary: earnings?.basicSalary || 0,
      houseRent: earnings?.houseRent || 0,
      medicalAllowance: earnings?.medicalAllowance || 0,
      conveyanceAllowance: earnings?.conveyanceAllowance || 0,
      vehicleAllowance: earnings?.vehicleAllowance || 0,
      fuelAllowance: earnings?.fuelAllowance || 0,
      vehicleFuelAllowance: 0,
      foodAllowance: earnings?.foodAllowance || 0,
      mobileAllowance: earnings?.mobileAllowance || 0,
      specialAllowance: earnings?.specialAllowance || 0,
      otherAllowances,
      overtime: earnings?.overtime || 0,
      bonus: earnings?.bonus || 0,
      incentives: earnings?.otherBonus || 0,
      arrears: earnings?.arrears || 0,
      otherEarnings: 0
    },
    deductions: {
      providentFund: deductions?.providentFund || 0,
      eobi: deductions?.eobi || 0,
      incomeTax: deductions?.incomeTax || 0,
      loanDeduction: deductions?.loanDeductions || 0,
      advanceDeduction: 0,
      lateDeduction: 0,
      absentDeduction: deductions?.attendanceDeduction || 0,
      otherDeductions: (deductions?.leaveDeduction || 0) + (deductions?.otherDeductions || 0)
    },
    totalDays: attendance?.totalDays || 0,
    presentDays: attendance?.presentDays || 0,
    absentDays: attendance?.absentDays || 0,
    totalEarnings: totals?.grossSalary || 0,
    totalDeductions: totals?.totalDeductions || 0,
    netSalary: totals?.netSalary || 0,
    remarks: remarks || `Monthly payslip for ${period?.monthName} ${period?.year}`
  };
};

export const downloadBlobFile = (blob, filename) => {
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
};

export const buildPayslipPdfFilename = (preview = {}) => {
  const first = preview.employee?.firstName || 'employee';
  const last = preview.employee?.lastName || '';
  const month = preview.period?.month || '';
  const year = preview.period?.year || '';
  return `payslip-${first}-${last}-${month}-${year}.pdf`.replace(/\s+/g, '-');
};
