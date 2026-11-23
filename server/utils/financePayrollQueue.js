const Payroll = require('../models/hr/Payroll');
const Employee = require('../models/hr/Employee');
const Project = require('../models/hr/Project');
const PayrollMonthlyComparisonReport = require('../models/hr/PayrollMonthlyComparisonReport');
const PayrollMonthlyApproval = require('../models/hr/PayrollMonthlyApproval');
const PayrollPeriodPaymentApplication = require('../models/finance/PayrollPeriodPaymentApplication');
const PayrollBankLetter = require('../models/finance/PayrollBankLetter');
const FinanceHelper = require('./financeHelper');
const { PAYROLL_FINAL_APPROVED_STATUSES } = require('./payrollAuthorityPayrollStatus');
const { getPayrollMonthlyComparisonReport } = require('./payrollMonthlyComparisonReport');
const { extractPayrollBreakdown } = require('./payrollBreakdown');

const MONTH_NAMES = [
  '', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

const AVP_READY_STATUSES = [...PAYROLL_FINAL_APPROVED_STATUSES, 'Paid'];

const parsePeriod = (month, year) => {
  const m = parseInt(month, 10);
  const y = parseInt(year, 10);
  if (!m || m < 1 || m > 12 || !y) {
    const err = new Error('Invalid month or year');
    err.statusCode = 400;
    throw err;
  }
  return { month: m, year: y };
};

const employeeDisplayName = (emp) =>
  [emp?.firstName, emp?.lastName].filter(Boolean).join(' ').trim() || emp?.employeeId || '—';

const resolvePlacementProjectName = (placementProject, projectNameById = null) => {
  if (!placementProject) return '';
  if (typeof placementProject === 'string') return placementProject;
  if (typeof placementProject === 'object' && placementProject.name) {
    return placementProject.name;
  }
  const projectId = String(placementProject._id || placementProject);
  if (projectNameById?.has(projectId)) {
    return projectNameById.get(projectId) || '';
  }
  return '';
};

const resolvePlacementCompanyName = (placementCompany) => {
  if (!placementCompany) return '';
  if (typeof placementCompany === 'string') return placementCompany;
  if (typeof placementCompany === 'object' && placementCompany.name) {
    return placementCompany.name;
  }
  return '';
};

const buildEmployeeProjectNameMap = async (payrollRows) => {
  const employeeIds = [
    ...new Set(payrollRows.map((row) => row.employee?._id).filter(Boolean))
  ];
  if (!employeeIds.length) return new Map();

  const employees = await Employee.find({ _id: { $in: employeeIds } })
    .select('placementProject')
    .populate('placementProject', 'name')
    .lean();

  const unresolvedProjectIds = employees
    .map((emp) => emp.placementProject)
    .filter((project) => project && !(typeof project === 'object' && project.name))
    .map((project) => project._id || project);

  const projectNameById = new Map();
  if (unresolvedProjectIds.length) {
    const projects = await Project.find({ _id: { $in: unresolvedProjectIds } })
      .select('name')
      .lean();
    projects.forEach((project) => {
      projectNameById.set(String(project._id), project.name || '');
    });
  }

  const map = new Map();
  employees.forEach((emp) => {
    map.set(
      String(emp._id),
      resolvePlacementProjectName(emp.placementProject, projectNameById)
    );
  });
  return map;
};

const mapFinancePayrollEmployee = (employee, projectByEmployeeId) => {
  if (!employee) return null;

  const project = resolvePlacementProjectName(employee.placementProject)
    || projectByEmployeeId.get(String(employee._id))
    || '';

  const company = resolvePlacementCompanyName(employee.placementCompany) || '';

  return {
    _id: employee._id,
    employeeId: employee.employeeId,
    name: employeeDisplayName(employee),
    idCard: employee.idCard || '',
    branchCode: employee.branchCode || '',
    accountNumber: employee.bankAccountNumber || employee.accountNumber || '',
    bankName: employee.bankName?.name || (typeof employee.bankName === 'object' ? employee.bankName?.name : '') || '',
    project,
    company
  };
};

const mapBankLetterRow = (payroll, employee, bank) => ({
  employeeId: employee?.employeeId || '—',
  name: employeeDisplayName(employee),
  cnic: employee?.idCard || '—',
  accountNumber: employee?.bankAccountNumber || employee?.accountNumber || '—',
  branchCode: employee?.branchCode || '—',
  bankName: bank?.name || (typeof employee?.bankName === 'object' ? employee.bankName?.name : '') || '—',
  netSalary: Math.round(Number(payroll?.netSalary) || 0),
  payrollId: String(payroll?._id || ''),
  status: payroll?.status || ''
});

const normalizeCompanyName = (value) => String(value || '').trim() || 'Unassigned';

const listCompanyPaymentStatus = async (month, year) => {
  const { month: m, year: y } = parsePeriod(month, year);
  const apps = await PayrollPeriodPaymentApplication.find({ month: m, year: y })
    .sort({ updatedAt: -1 })
    .populate('journalEntryId', 'reference status entryNumber')
    .lean();

  const byCompany = new Map();
  apps.forEach((app) => {
    const key = normalizeCompanyName(app.companyName);
    if (!byCompany.has(key)) byCompany.set(key, []);
    byCompany.get(key).push(app);
  });

  return [...byCompany.entries()].map(([companyName, companyApps]) => ({
    companyName,
    draftPayment: companyApps.find((app) => app.workflowStatus === 'draft') || null,
    pendingPayment: companyApps.find((app) => app.workflowStatus === 'pending_authority') || null,
    latestRejection: companyApps.find((app) => app.workflowStatus === 'rejected') || null,
    latestApproval: companyApps.find((app) => app.workflowStatus === 'fully_approved') || null
  }));
};

const listFinancePayrollQueue = async () => {
  const rows = await Payroll.aggregate([
    {
      $match: {
        status: { $in: AVP_READY_STATUSES }
      }
    },
    {
      $group: {
        _id: { month: '$month', year: '$year' },
        employeeCount: { $sum: 1 },
        // Half-up per employee like Math.round in the payroll export ($round would round .5 to even)
        totalNetSalary: { $sum: { $floor: { $add: [{ $ifNull: ['$netSalary', 0] }, 0.5] } } },
        totalGrossSalary: { $sum: { $floor: { $add: [{ $ifNull: ['$grossSalary', 0] }, 0.5] } } },
        pendingCount: {
          $sum: {
            $cond: [{ $in: ['$status', PAYROLL_FINAL_APPROVED_STATUSES] }, 1, 0]
          }
        },
        paidCount: {
          $sum: {
            $cond: [{ $eq: ['$status', 'Paid'] }, 1, 0]
          }
        }
      }
    },
    { $sort: { '_id.year': -1, '_id.month': -1 } }
  ]);

  const periods = await Promise.all(
    rows.map(async (row) => {
      const { month, year } = row._id;
      const [comparisonDoc, approvalDoc, pendingPayments, draftPayments] = await Promise.all([
        PayrollMonthlyComparisonReport.findOne({ month, year })
          .select('status generatedAt approvedAt')
          .lean(),
        PayrollMonthlyApproval.findOne({ month, year })
          .select('authorityStatus financeAuthorityApprovals')
          .populate('financeAuthorityApprovals.approver', 'firstName lastName')
          .lean(),
        PayrollPeriodPaymentApplication.find({ month, year, workflowStatus: 'pending_authority' })
          .select('_id amount companyName journalEntryId workflowStatus')
          .lean(),
        PayrollPeriodPaymentApplication.find({ month, year, workflowStatus: 'draft' })
          .select('_id amount companyName journalEntryId workflowStatus paymentMeta')
          .lean()
      ]);

      const avpApproved = PAYROLL_FINAL_APPROVED_STATUSES.includes(comparisonDoc?.status)
        || row.pendingCount > 0
        || row.paidCount > 0;

      if (!avpApproved) return null;

      const financeStatus = pendingPayments.length
        ? 'payment_pending'
        : draftPayments.length
          ? 'draft_payment'
          : row.pendingCount > 0
            ? 'pending_payment'
            : 'paid';

      return {
        month,
        year,
        periodLabel: `${MONTH_NAMES[month]} ${year}`,
        employeeCount: row.employeeCount,
        totalNetSalary: Math.round(row.totalNetSalary || 0),
        totalGrossSalary: Math.round(row.totalGrossSalary || 0),
        pendingCount: row.pendingCount,
        paidCount: row.paidCount,
        financeStatus,
        comparisonStatus: comparisonDoc?.status || '—',
        comparisonGeneratedAt: comparisonDoc?.generatedAt || null,
        comparisonApprovedAt: comparisonDoc?.approvedAt || null,
        approvalStatus: approvalDoc?.authorityStatus || 'pending',
        pendingPaymentCount: pendingPayments.length,
        pendingPaymentAmount: pendingPayments.reduce((sum, item) => sum + (Number(item.amount) || 0), 0),
        draftPaymentCount: draftPayments.length
      };
    })
  );

  return periods.filter(Boolean);
};

const getFinancePayrollPeriodDetail = async (month, year) => {
  const { month: m, year: y } = parsePeriod(month, year);

  const payrolls = await Payroll.find({ month: m, year: y, status: { $in: AVP_READY_STATUSES } })
    .populate({
      path: 'employee',
      select: 'firstName lastName employeeId idCard branchCode bankAccountNumber accountNumber bankName placementProject placementCompany cashSalary',
      populate: [
        { path: 'placementProject', select: 'name' },
        { path: 'placementCompany', select: 'name' },
        { path: 'bankName', select: 'name' }
      ]
    })
    .sort({ 'employee.employeeId': 1 })
    .lean();

  if (!payrolls.length) {
    const err = new Error('No GM HR-approved payroll found for this period');
    err.statusCode = 404;
    throw err;
  }

  const projectByEmployeeId = await buildEmployeeProjectNameMap(payrolls);

  const summary = payrolls.reduce(
    (acc, row) => {
      acc.employeeCount += 1;
      acc.totalGrossSalary += Math.round(Number(row.grossSalary) || 0);
      acc.totalNetSalary += Math.round(Number(row.netSalary) || 0);
      if (PAYROLL_FINAL_APPROVED_STATUSES.includes(row.status)) acc.pendingCount += 1;
      if (row.status === 'Paid') acc.paidCount += 1;
      return acc;
    },
    { employeeCount: 0, totalGrossSalary: 0, totalNetSalary: 0, pendingCount: 0, paidCount: 0 }
  );

  const [comparisonWrap, approvalDoc, pendingPayments, draftPayments, companyPayments, bankLetters] = await Promise.all([
    getPayrollMonthlyComparisonReport(m, y).catch(() => null),
    PayrollMonthlyApproval.findOne({ month: m, year: y })
      .populate('financeApprovalAuthorities.accountsOfficerUser', 'firstName lastName')
      .populate('financeApprovalAuthorities.financeControllerUser', 'firstName lastName')
      .populate('financeApprovalAuthorities.accountsManagerUser', 'firstName lastName')
      .populate('financeAuthorityApprovals.approver', 'firstName lastName')
      .lean(),
    PayrollPeriodPaymentApplication.find({ month: m, year: y, workflowStatus: 'pending_authority' })
      .populate('journalEntryId', 'reference status entryNumber')
      .lean(),
    PayrollPeriodPaymentApplication.find({ month: m, year: y, workflowStatus: 'draft' })
      .populate('journalEntryId', 'reference status entryNumber')
      .lean(),
    listCompanyPaymentStatus(m, y),
    PayrollBankLetter.find({ month: m, year: y })
      .sort({ generatedAt: -1 })
      .populate('generatedBy', 'firstName lastName email')
      .populate('journalEntryId', 'entryNumber reference status')
      .populate('paymentApplicationId', 'workflowStatus amount finalizedAt')
      .lean()
  ]);

  return {
    month: m,
    year: y,
    periodLabel: `${MONTH_NAMES[m]} ${y}`,
    summary: {
      ...summary,
      totalGrossSalary: Math.round(summary.totalGrossSalary),
      totalNetSalary: Math.round(summary.totalNetSalary),
      financeStatus: summary.pendingCount > 0
        ? (pendingPayments.length ? 'payment_pending' : 'pending_payment')
        : 'paid'
    },
    comparisonReport: comparisonWrap?.report || null,
    comparisonMeta: {
      status: comparisonWrap?.status || null,
      generatedAt: comparisonWrap?.generatedAt || null,
      fromCache: comparisonWrap?.fromCache ?? false
    },
    approval: approvalDoc,
    pendingPayments,
    draftPayments,
    companyPayments,
    bankLetters,
    payrolls: payrolls.map((row) => ({
      _id: row._id,
      status: row.status,
      netSalary: row.netSalary,
      grossSalary: row.grossSalary,
      isCashSalary: Boolean(row.isCashSalary),
      ...extractPayrollBreakdown(row),
      employee: mapFinancePayrollEmployee(row.employee, projectByEmployeeId)
    }))
  };
};

const getFinancePayrollBankLetter = async (month, year) => {
  const { month: m, year: y } = parsePeriod(month, year);

  const payrolls = await Payroll.find({
    month: m,
    year: y,
    status: { $in: [...PAYROLL_FINAL_APPROVED_STATUSES, 'Paid'] }
  })
    .populate({
      path: 'employee',
      select: 'firstName lastName employeeId idCard branchCode bankAccountNumber accountNumber bankName cashSalary',
      populate: { path: 'bankName', select: 'name' }
    })
    .lean();

  if (!payrolls.length) {
    const err = new Error('No payroll records available for bank letter');
    err.statusCode = 404;
    throw err;
  }

  const rows = payrolls
    .filter((p) => p.employee && !p.isCashSalary)
    .map((p) => mapBankLetterRow(p, p.employee, p.employee.bankName))
    .sort((a, b) => String(a.employeeId).localeCompare(String(b.employeeId), undefined, { numeric: true }));

  const totalNetSalary = rows.reduce((sum, row) => sum + (Number(row.netSalary) || 0), 0);

  return {
    month: m,
    year: y,
    periodLabel: `${MONTH_NAMES[m]} ${y}`,
    generatedAt: new Date(),
    employeeCount: rows.length,
    totalNetSalary,
    rows
  };
};

const markFinancePayrollPeriodPaid = async (month, year, { paymentMethod = 'bank_transfer', actorId } = {}) => {
  const { month: m, year: y } = parsePeriod(month, year);

  const payrolls = await Payroll.find({
    month: m,
    year: y,
    status: { $in: PAYROLL_FINAL_APPROVED_STATUSES }
  });

  if (!payrolls.length) {
    const err = new Error('No pending GM HR-approved payrolls to mark as paid');
    err.statusCode = 400;
    throw err;
  }

  let paid = 0;
  const errors = [];

  for (const payroll of payrolls) {
    try {
      await payroll.markAsPaid(paymentMethod === 'cash' ? 'Cash' : 'Bank Transfer');
      await FinanceHelper.recordPayrollPayment(payroll, paymentMethod, actorId);
      paid += 1;
    } catch (error) {
      errors.push({
        payrollId: String(payroll._id),
        message: error.message
      });
    }
  }

  return { paid, failed: errors.length, errors };
};

module.exports = {
  MONTH_NAMES,
  parsePeriod,
  listFinancePayrollQueue,
  getFinancePayrollPeriodDetail,
  getFinancePayrollBankLetter,
  markFinancePayrollPeriodPaid,
  mapBankLetterRow
};
