const express = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const JournalEntry = require('../models/finance/JournalEntry');
const Account = require('../models/finance/Account');
const AccountsPayable = require('../models/finance/AccountsPayable');
const AccountsReceivable = require('../models/finance/AccountsReceivable');
const PlacementCompany = require('../models/hr/Company');
const Employee = require('../models/hr/Employee');
const Payroll = require('../models/hr/Payroll');
const Attendance = require('../models/hr/Attendance');
const PurchaseOrder = require('../models/procurement/PurchaseOrder');
require('../models/hr/Supplier'); // PurchaseOrder.vendor populate
const CashApproval = require('../models/procurement/CashApproval');
const Indent = require('../models/general/Indent');
const ConstructionProject = require('../models/projectManagement/ConstructionProject');
const ProjectInvoice = require('../models/projectManagement/ProjectInvoice');
const TajTransaction = require('../models/tajResidencia/TajTransaction');
const PropertyInvoice = require('../models/tajResidencia/PropertyInvoice');
const Complaint = require('../models/tajResidencia/Complaint');
const PresidentMeeting = require('../models/general/PresidentMeeting');
const PresidentEvent = require('../models/general/PresidentEvent');

const router = express.Router();

/** Only the President (employee position exactly "President") and the developer role */
const hasPresidentDashboardAccess = (user) => {
  if (!user) return false;
  if (String(user.role || '') === 'developer') return true;
  return String(user.position || '').trim().toLowerCase() === 'president';
};

router.use((req, res, next) => {
  if (hasPresidentDashboardAccess(req.user)) return next();
  return res.status(403).json({ success: false, message: 'You do not have access to the President Dashboard' });
});

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const sumOf = (list, f) => r2(list.reduce((t, x) => t + (Number(typeof f === 'function' ? f(x) : x[f]) || 0), 0));
const DAY_MS = 24 * 3600 * 1000;

// Every date on this dashboard is judged in Pakistan time (UTC+5, no DST)
const PK_TZ = 'Asia/Karachi';
const PK_OFFSET_MS = 5 * 3600 * 1000;
const pkParts = (date = new Date()) => {
  const pk = new Date(date.getTime() + PK_OFFSET_MS);
  return { y: pk.getUTCFullYear(), m: pk.getUTCMonth(), d: pk.getUTCDate() };
};
/** UTC instant of 00:00 Pakistan time on the given Pakistan calendar day (month may overflow) */
const pkDate = (y, m, d = 1) => new Date(Date.UTC(y, m, d) - PK_OFFSET_MS);
const monthKey = (y, m) => `${y}-${String(m + 1).padStart(2, '0')}`;
/** Last `count` Pakistan months, oldest first, ending with the current one */
const lastMonths = (count) => {
  const { y, m } = pkParts();
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(Date.UTC(y, m - (count - 1) + i, 1));
    return {
      key: monthKey(d.getUTCFullYear(), d.getUTCMonth()),
      y: d.getUTCFullYear(),
      m: d.getUTCMonth(),
      label: d.toLocaleString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' })
    };
  });
};
const daysWaiting = (date, now) => (date ? Math.max(0, Math.floor((now - new Date(date)) / DAY_MS)) : null);

/** Run one panel; a failing panel reports its error instead of taking the whole dashboard down */
const safe = async (name, fn) => {
  try {
    return await fn();
  } catch (err) {
    console.error(`President dashboard: ${name} failed:`, err.message);
    return { error: `Could not load ${name}` };
  }
};

// Year-end closing journals are left out of P&L, as on the Finance dashboard
const notClosingEntry = { reference: { $not: /^CLOSE-/ } };

/** Group finance: cash & bank, P&L this month vs last, 12-month trend, receivables and payables — all companies */
const financePanel = async () => {
  const months = lastMonths(12);
  const now = new Date();
  const { y, m } = pkParts(now);
  const thisMonthStart = pkDate(y, m, 1);
  const lastMonthStart = pkDate(y, m - 1, 1);
  const first = pkDate(months[0].y, months[0].m, 1);

  const cashAccounts = await Account.find({
    type: 'Asset',
    isActive: { $ne: false },
    $or: [
      { detailType: { $in: ['Bank', 'Cash and Cash Equivalents', 'Cash on hand'] } },
      { category: { $regex: /^cash/i } }
    ]
  }).select('_id companyId').lean();
  const cashIds = cashAccounts.map((a) => a._id);

  const [plMonthly, cashMonthly, cashByCompany, apOpen, arOpen, companies] = await Promise.all([
    JournalEntry.aggregate([
      { $match: { status: 'posted', ...notClosingEntry, date: { $gte: first, $lte: now } } },
      { $unwind: '$lines' },
      { $lookup: { from: 'accounts', localField: 'lines.account', foreignField: '_id', as: 'acc' } },
      { $unwind: '$acc' },
      { $match: { 'acc.type': { $in: ['Revenue', 'Expense'] } } },
      {
        $group: {
          _id: { k: { $dateToString: { format: '%Y-%m', date: '$date', timezone: PK_TZ } }, t: '$acc.type' },
          debit: { $sum: '$lines.debit' },
          credit: { $sum: '$lines.credit' }
        }
      }
    ]),
    cashIds.length ? JournalEntry.aggregate([
      { $match: { status: 'posted', date: { $lte: now } } },
      { $unwind: '$lines' },
      { $match: { 'lines.account': { $in: cashIds } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m', date: '$date', timezone: PK_TZ } },
          net: { $sum: { $subtract: ['$lines.debit', '$lines.credit'] } },
          cashIn: { $sum: '$lines.debit' },
          cashOut: { $sum: '$lines.credit' }
        }
      }
    ]) : [],
    cashIds.length ? JournalEntry.aggregate([
      { $match: { status: 'posted', date: { $lte: now } } },
      { $unwind: '$lines' },
      { $match: { 'lines.account': { $in: cashIds } } },
      { $group: { _id: '$companyId', balance: { $sum: { $subtract: ['$lines.debit', '$lines.credit'] } } } }
    ]) : [],
    AccountsPayable.find({ status: { $nin: ['cancelled', 'paid', 'draft'] }, voidedAt: null, balanceDue: { $gt: 0.005 } })
      .select('balanceDue dueDate').lean(),
    AccountsReceivable.find({ status: { $nin: ['cancelled', 'paid', 'draft'] }, balanceDue: { $gt: 0.005 } })
      .select('balanceDue dueDate').lean(),
    PlacementCompany.find({}).select('name companyCode').lean()
  ]);

  const pick = (k, t) => plMonthly.find((x) => x._id.k === k && x._id.t === t) || { debit: 0, credit: 0 };
  const firstKey = months[0].key;
  let running = cashMonthly.filter((x) => x._id < firstKey).reduce((t, x) => t + x.net, 0);
  const trend = months.map(({ key, label }) => {
    const revenue = r2(pick(key, 'Revenue').credit - pick(key, 'Revenue').debit);
    const expenses = r2(pick(key, 'Expense').debit - pick(key, 'Expense').credit);
    const cash = cashMonthly.find((x) => x._id === key);
    running += cash?.net || 0;
    return {
      month: key,
      label,
      revenue,
      expenses,
      netProfit: r2(revenue - expenses),
      cashBalance: r2(running),
      cashIn: r2(cash?.cashIn),
      cashOut: r2(cash?.cashOut)
    };
  });
  const current = trend[trend.length - 1];
  const previous = trend[trend.length - 2];

  const ytdStartMonth = monthKey(y, 0);
  const ytd = trend.filter((t) => t.month >= ytdStartMonth);

  const companyName = new Map(companies.map((c) => [String(c._id), c.name]));
  const cashCompanies = cashByCompany
    .map((x) => ({ companyId: x._id || null, name: x._id ? (companyName.get(String(x._id)) || 'Unknown company') : 'No company set', balance: r2(x.balance) }))
    .filter((x) => Math.abs(x.balance) > 0.5)
    .sort((a, b) => b.balance - a.balance);

  const overdue = (list) => list.filter((b) => b.dueDate && new Date(b.dueDate) < now);
  return {
    cash: {
      total: current.cashBalance,
      previousMonthEnd: previous.cashBalance,
      byCompany: cashCompanies
    },
    thisMonth: { revenue: current.revenue, expenses: current.expenses, netProfit: current.netProfit, cashIn: current.cashIn, cashOut: current.cashOut },
    lastMonth: { revenue: previous.revenue, expenses: previous.expenses, netProfit: previous.netProfit },
    yearToDate: {
      revenue: sumOf(ytd, 'revenue'),
      expenses: sumOf(ytd, 'expenses'),
      netProfit: sumOf(ytd, 'netProfit')
    },
    trend,
    payables: { total: sumOf(apOpen, 'balanceDue'), count: apOpen.length, overdue: sumOf(overdue(apOpen), 'balanceDue'), overdueCount: overdue(apOpen).length },
    receivables: { total: sumOf(arOpen, 'balanceDue'), count: arOpen.length, overdue: sumOf(overdue(arOpen), 'balanceDue'), overdueCount: overdue(arOpen).length },
    monthStart: thisMonthStart,
    lastMonthStart
  };
};

/** People: headcount by company, joiners / leavers, payroll trend and today's attendance */
const peoplePanel = async () => {
  const months = lastMonths(6);
  const { y, m, d } = pkParts();
  const monthStart = pkDate(y, m, 1);
  const sixStart = pkDate(months[0].y, months[0].m, 1);
  const todayStart = pkDate(y, m, d);
  const todayEnd = pkDate(y, m, d + 1);
  const active = { isDeleted: { $ne: true }, isActive: true, employmentStatus: 'Active' };

  const [headcount, byCompany, joiners, leavers, payroll, attendance] = await Promise.all([
    Employee.countDocuments(active),
    Employee.aggregate([
      { $match: active },
      { $group: { _id: '$placementCompany', count: { $sum: 1 } } },
      { $lookup: { from: 'placementcompanies', localField: '_id', foreignField: '_id', as: 'co' } },
      { $project: { count: 1, name: { $ifNull: [{ $arrayElemAt: ['$co.name', 0] }, 'Not assigned'] } } },
      { $sort: { count: -1 } }
    ]),
    Employee.aggregate([
      { $match: { isDeleted: { $ne: true }, employmentStatus: { $ne: 'Draft' }, joiningDate: { $gte: sixStart } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$joiningDate', timezone: PK_TZ } }, count: { $sum: 1 } } }
    ]),
    Employee.aggregate([
      { $match: { isDeleted: { $ne: true }, employmentStatus: { $in: ['Terminated', 'Resigned', 'Retired', 'Inactive'] }, terminationDate: { $gte: sixStart } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$terminationDate', timezone: PK_TZ } }, count: { $sum: 1 } } }
    ]),
    Payroll.aggregate([
      { $match: { status: { $ne: 'Draft' }, $or: months.map((x) => ({ year: x.y, month: x.m + 1 })) } },
      { $group: { _id: { y: '$year', m: '$month' }, gross: { $sum: '$grossSalary' }, net: { $sum: '$netSalary' }, employees: { $sum: 1 } } }
    ]),
    Attendance.aggregate([
      { $match: { isActive: { $ne: false }, date: { $gte: todayStart, $lt: todayEnd } } },
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ])
  ]);

  const trend = months.map((x) => {
    const p = payroll.find((r) => r._id.y === x.y && r._id.m === x.m + 1);
    return {
      month: x.key,
      label: x.label,
      joined: joiners.find((r) => r._id === x.key)?.count || 0,
      left: leavers.find((r) => r._id === x.key)?.count || 0,
      payrollGross: r2(p?.gross),
      payrollNet: r2(p?.net),
      payrollEmployees: p?.employees || 0
    };
  });
  const lastPayroll = [...trend].reverse().find((t) => t.payrollNet > 0) || null;
  const att = (statuses) => attendance.filter((a) => statuses.includes(a._id)).reduce((t, a) => t + a.count, 0);
  const present = att(['Present', 'Late', 'Half Day']);
  const onLeave = att(['Leave', 'Sick Leave', 'Personal Leave', 'Maternity Leave', 'Paternity Leave']);
  const absent = att(['Absent']);
  const late = att(['Late']);

  return {
    headcount,
    joinedThisMonth: trend[trend.length - 1].joined,
    leftThisMonth: trend[trend.length - 1].left,
    byCompany: byCompany.map((c) => ({ name: c.name, count: c.count })),
    trend,
    lastPayroll: lastPayroll && { month: lastPayroll.month, label: lastPayroll.label, gross: lastPayroll.payrollGross, net: lastPayroll.payrollNet, employees: lastPayroll.payrollEmployees },
    attendanceToday: { marked: present + onLeave + absent, present, late, onLeave, absent },
    monthStart
  };
};

const CEO_STAGES = ['Send to CEO Office', 'Forwarded to CEO'];
const PO_IN_APPROVAL = ['Pending Approval', 'Pending Audit', 'Forwarded to Audit Director', 'Pending Finance', ...CEO_STAGES];
const CA_IN_APPROVAL = ['Pending Approval', 'Pending Audit', 'Forwarded to Audit Director', 'Pending Finance', ...CEO_STAGES];
const IPC_IN_APPROVAL = ['Pending Audit', 'Forwarded to Audit Director', ...CEO_STAGES];
const INDENT_PENDING = ['Submitted', 'Under Review'];

/**
 * Decisions waiting: what sits at the CEO office now (oldest first) and what is still moving
 * through audit / finance, for purchase orders, cash approvals, contractor IPCs, project budgets and indents.
 */
const approvalsPanel = async () => {
  const now = new Date();
  const [pos, cas, ipcs, budgets, indents] = await Promise.all([
    PurchaseOrder.find({ status: { $in: PO_IN_APPROVAL } })
      .select('orderNumber status totalAmount vendor updatedAt createdAt')
      .populate('vendor', 'name').lean(),
    CashApproval.find({ status: { $in: CA_IN_APPROVAL } })
      .select('caNumber status totalAmount purpose originatingModule updatedAt createdAt').lean(),
    ProjectInvoice.find({ invoiceType: 'Subcontractor_IPC', status: { $ne: 'Cancelled' }, approvalStatus: { $in: IPC_IN_APPROVAL } })
      .select('invoiceNumber ipcNumber approvalStatus netPayableAmount grossAmount project submittedAt updatedAt createdAt')
      .populate('project', 'name parentProject').lean(),
    ConstructionProject.find({ parentProject: null, status: { $ne: 'Cancelled' }, budgetStatus: 'Submitted' })
      .select('name projectNumber lumpSumBudget budgetSubmittedAt budgetRequest.approvers budgetRequest.currentStep').lean(),
    Indent.find({ status: { $in: INDENT_PENDING } }).select('indentNumber title status priority requestedDate createdAt').lean()
  ]);

  const kind = (label, list, { amount, stageOf, item }) => {
    const atCeo = list.filter((x) => CEO_STAGES.includes(stageOf(x)));
    const items = atCeo.map(item).sort((a, b) => (b.days ?? 0) - (a.days ?? 0));
    return {
      label,
      inApproval: list.length,
      inApprovalAmount: sumOf(list, amount),
      atCeo: atCeo.length,
      atCeoAmount: sumOf(atCeo, amount),
      oldestDays: items.length ? items[0].days : null,
      items: items.slice(0, 6)
    };
  };

  const purchaseOrders = kind('Purchase orders', pos, {
    amount: 'totalAmount',
    stageOf: (x) => x.status,
    item: (x) => ({ id: x._id, number: x.orderNumber, title: x.vendor?.name || 'Vendor', amount: r2(x.totalAmount), days: daysWaiting(x.updatedAt || x.createdAt, now) })
  });
  const cashApprovals = kind('Cash approvals', cas, {
    amount: 'totalAmount',
    stageOf: (x) => x.status,
    item: (x) => ({ id: x._id, number: x.caNumber, title: x.purpose || 'Cash approval', module: x.originatingModule, amount: r2(x.totalAmount), days: daysWaiting(x.updatedAt || x.createdAt, now) })
  });
  const contractorIpcs = kind('Contractor IPCs', ipcs, {
    amount: (x) => Number(x.netPayableAmount) || Number(x.grossAmount) || 0,
    stageOf: (x) => x.approvalStatus,
    item: (x) => ({ id: x._id, number: x.invoiceNumber || `IPC ${x.ipcNumber}`, title: x.project?.name || 'Project', projectId: x.project?._id, amount: r2(Number(x.netPayableAmount) || Number(x.grossAmount)), days: daysWaiting(x.updatedAt || x.submittedAt || x.createdAt, now) })
  });

  const budgetItems = budgets.map((b) => {
    const step = b.budgetRequest?.approvers?.[b.budgetRequest.currentStep];
    return {
      id: b._id,
      number: b.projectNumber,
      title: b.name,
      withWhom: step ? `${step.name || ''}${step.role ? ` (${step.role})` : ''}`.trim() : '',
      amount: r2(b.lumpSumBudget),
      days: daysWaiting(b.budgetSubmittedAt, now)
    };
  }).sort((a, b) => (b.days ?? 0) - (a.days ?? 0));

  return {
    purchaseOrders,
    cashApprovals,
    contractorIpcs,
    projectBudgets: {
      label: 'Project budgets',
      inApproval: budgets.length,
      inApprovalAmount: sumOf(budgetItems, 'amount'),
      oldestDays: budgetItems.length ? budgetItems[0].days : null,
      items: budgetItems.slice(0, 6)
    },
    indents: {
      label: 'Indents',
      inApproval: indents.length,
      urgent: indents.filter((x) => ['Urgent', 'High'].includes(x.priority)).length,
      oldestDays: indents.length ? Math.max(...indents.map((x) => daysWaiting(x.requestedDate || x.createdAt, now) || 0)) : null
    },
    totalAtCeo: purchaseOrders.atCeo + cashApprovals.atCeo + contractorIpcs.atCeo,
    totalAtCeoAmount: r2(purchaseOrders.atCeoAmount + cashApprovals.atCeoAmount + contractorIpcs.atCeoAmount)
  };
};

/** Projects: main projects by status, budget vs certified vs paid, the ones running late */
const projectsPanel = async () => {
  const now = new Date();
  const mains = await ConstructionProject.find({ parentProject: null, status: { $ne: 'Cancelled' } })
    .select('name projectNumber status overallProgress startDate expectedEndDate approvedBudget.amount lumpSumBudget budgetStatus society sector')
    .lean();
  const mainIds = mains.map((x) => x._id);
  const subs = await ConstructionProject.find({ parentProject: { $in: mainIds }, status: { $ne: 'Cancelled' } }).select('_id parentProject').lean();
  const mainOf = new Map(subs.map((s) => [String(s._id), String(s.parentProject)]));
  const ids = [...mainIds, ...subs.map((s) => s._id)];

  const [ipcRows, clientRows] = await Promise.all([
    ProjectInvoice.aggregate([
      { $match: { project: { $in: ids }, invoiceType: 'Subcontractor_IPC', status: { $ne: 'Cancelled' } } },
      {
        $group: {
          _id: '$project',
          certified: { $sum: { $cond: [{ $in: ['$ipcKind', ['Advance', 'Retention Release']] }, 0, { $ifNull: ['$grossAmount', 0] }] } },
          paid: { $sum: { $ifNull: ['$paidAmount', 0] } }
        }
      }
    ]),
    ProjectInvoice.aggregate([
      { $match: { project: { $in: ids }, invoiceType: 'Client_Invoice', status: { $ne: 'Cancelled' } } },
      { $group: { _id: '$project', billed: { $sum: { $ifNull: ['$invoiceAmount', '$grossAmount'] } }, received: { $sum: { $ifNull: ['$paidAmount', 0] } } } }
    ])
  ]);
  const roll = (rows, fields) => {
    const out = new Map();
    rows.forEach((r) => {
      const key = mainOf.get(String(r._id)) || String(r._id);
      const cur = out.get(key) || {};
      fields.forEach((f) => { cur[f] = (cur[f] || 0) + (Number(r[f]) || 0); });
      out.set(key, cur);
    });
    return out;
  };
  const ipcByMain = roll(ipcRows, ['certified', 'paid']);
  const clientByMain = roll(clientRows, ['billed', 'received']);

  const list = mains.map((p) => {
    const id = String(p._id);
    const budget = Number(p.approvedBudget?.amount) || (p.budgetStatus === 'Approved' ? Number(p.lumpSumBudget) || 0 : 0);
    const money = ipcByMain.get(id) || {};
    const client = clientByMain.get(id) || {};
    const progress = Number(p.overallProgress) || 0;
    const overdue = Boolean(p.expectedEndDate && p.status !== 'Completed' && now > new Date(new Date(p.expectedEndDate).getTime() + DAY_MS));
    let plannedProgress = null;
    if (p.startDate && p.expectedEndDate) {
      const span = new Date(p.expectedEndDate) - new Date(p.startDate);
      if (span > 0) plannedProgress = Math.max(0, Math.min(100, Math.round(((now - new Date(p.startDate)) / span) * 100)));
    }
    const certified = r2(money.certified);
    let health = 'On Track';
    if (budget > 0 && certified > budget) health = 'Over Budget';
    else if (overdue || (p.status === 'Active' && plannedProgress !== null && plannedProgress - progress > 25)) health = 'Behind Schedule';
    return {
      _id: p._id,
      name: p.name,
      projectNumber: p.projectNumber,
      status: p.status,
      location: [p.society, p.sector].filter(Boolean).join(', '),
      progress,
      plannedProgress,
      overdue,
      daysOverdue: overdue ? Math.ceil((now - new Date(p.expectedEndDate)) / DAY_MS) : 0,
      expectedEndDate: p.expectedEndDate,
      budget: r2(budget),
      certified,
      paid: r2(money.paid),
      clientBilled: r2(client.billed),
      clientReceived: r2(client.received),
      health
    };
  });

  const byStatus = ['Active', 'Planning', 'On Hold', 'Completed', 'Draft']
    .map((s) => ({ status: s, count: list.filter((p) => p.status === s).length }))
    .filter((x) => x.count);
  const live = list.filter((p) => p.status !== 'Completed');
  const totalBudget = sumOf(list, 'budget');
  const weighted = totalBudget > 0
    ? Math.round(list.reduce((t, p) => t + p.progress * p.budget, 0) / totalBudget)
    : (list.length ? Math.round(list.reduce((t, p) => t + p.progress, 0) / list.length) : 0);

  return {
    count: list.length,
    byStatus,
    totals: {
      budget: totalBudget,
      certified: sumOf(list, 'certified'),
      paid: sumOf(list, 'paid'),
      clientBilled: sumOf(list, 'clientBilled'),
      clientReceived: sumOf(list, 'clientReceived')
    },
    overallProgress: weighted,
    atRisk: live.filter((p) => p.health !== 'On Track')
      .sort((a, b) => (b.health === 'Over Budget') - (a.health === 'Over Budget') || b.daysOverdue - a.daysOverdue)
      .slice(0, 5),
    top: [...live].sort((a, b) => b.budget - a.budget || b.certified - a.certified).slice(0, 6)
  };
};

/** Taj Residencia: cash received per month (as on the Deposits page), unpaid bills, open complaints */
const tajPanel = async () => {
  const months = lastMonths(12);
  const since = pkDate(months[0].y, months[0].m, 1);
  const [deposits, outstanding, complaints] = await Promise.all([
    TajTransaction.aggregate([
      {
        $match: {
          transactionType: 'deposit',
          createdAt: { $gte: since },
          $or: [
            { referenceNumberExternal: { $not: /^REV-/ } },
            { referenceNumberExternal: { $exists: false } },
            { referenceNumberExternal: null }
          ]
        }
      },
      { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$createdAt', timezone: PK_TZ } }, amount: { $sum: '$amount' }, count: { $sum: 1 } } }
    ]),
    PropertyInvoice.aggregate([
      { $match: { status: { $nin: ['Cancelled', 'Paid', 'Draft'] }, balance: { $gt: 0.005 } } },
      { $group: { _id: null, amount: { $sum: '$balance' }, count: { $sum: 1 } } }
    ]),
    Complaint.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }])
  ]);
  const trend = months.map((x) => {
    const row = deposits.find((d) => d._id === x.key);
    return { month: x.key, label: x.label, amount: r2(row?.amount), count: row?.count || 0 };
  });
  const c = (s) => complaints.filter((x) => s.includes(x._id)).reduce((t, x) => t + x.count, 0);
  return {
    collectedThisMonth: trend[trend.length - 1].amount,
    collectedLastMonth: trend[trend.length - 2].amount,
    trend,
    outstanding: { amount: r2(outstanding[0]?.amount), count: outstanding[0]?.count || 0 },
    complaints: { open: c(['New', 'Contacted', 'Hold', 'Approval Required', 'Others']), new: c(['New']), approvalRequired: c(['Approval Required']), completed: c(['Completed']) }
  };
};

/** President's agenda: today's meetings and events, the next 7 days, and requests waiting to be scheduled */
const agendaPanel = async () => {
  const { y, m, d } = pkParts();
  const todayStart = pkDate(y, m, d);
  const todayEnd = pkDate(y, m, d + 1);
  const weekEnd = pkDate(y, m, d + 8);
  const live = ['Scheduled', 'Postponed'];
  const [meetings, events, requests] = await Promise.all([
    PresidentMeeting.find({ isActive: { $ne: false }, status: { $in: live }, meetingDate: { $gte: todayStart, $lt: weekEnd } })
      .select('meetingNumber title meetingDate startTime endTime venue meetingType status attendees')
      .sort({ meetingDate: 1, startTime: 1 }).lean(),
    PresidentEvent.find({ isActive: { $ne: false }, status: { $in: live }, eventDate: { $gte: todayStart, $lt: weekEnd } })
      .select('eventNumber title eventDate startTime endTime venue eventType host status')
      .sort({ eventDate: 1, startTime: 1 }).lean(),
    PresidentMeeting.countDocuments({ isActive: { $ne: false }, status: 'Requested' })
  ]);
  const items = [
    ...meetings.map((x) => ({
      id: x._id, kind: 'Meeting', number: x.meetingNumber, title: x.title, date: x.meetingDate, startTime: x.startTime || '', endTime: x.endTime || '',
      venue: x.venue || '', type: x.meetingType || '', status: x.status, people: (x.attendees || []).length
    })),
    ...events.map((x) => ({
      id: x._id, kind: 'Event', number: x.eventNumber, title: x.title, date: x.eventDate, startTime: x.startTime || '', endTime: x.endTime || '',
      venue: typeof x.venue === 'string' ? x.venue : (x.venue?.name || ''), type: x.eventType || '', status: x.status, host: x.host || ''
    }))
  ].sort((a, b) => new Date(a.date) - new Date(b.date) || String(a.startTime).localeCompare(String(b.startTime)));
  const isToday = (x) => new Date(x.date) >= todayStart && new Date(x.date) < todayEnd;
  return {
    today: items.filter(isToday),
    upcoming: items.filter((x) => !isToday(x)).slice(0, 8),
    nextSevenDays: items.length,
    requestsWaiting: requests
  };
};

// @route   GET /api/president-dashboard/overview
// @desc    Group-wide command center for the President: every panel in one call
// @access  President and developer only
router.get('/overview', asyncHandler(async (req, res) => {
  const [finance, people, approvals, projects, taj, agenda] = await Promise.all([
    safe('finance', financePanel),
    safe('people', peoplePanel),
    safe('approvals', approvalsPanel),
    safe('projects', projectsPanel),
    safe('Taj Residencia', tajPanel),
    safe('agenda', agendaPanel)
  ]);
  res.json({ success: true, data: { generatedAt: new Date(), finance, people, approvals, projects, taj, agenda } });
}));

module.exports = router;
