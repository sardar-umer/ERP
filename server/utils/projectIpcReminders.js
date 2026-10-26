/**
 * IPC approval-chain timing: how long IPCs sit at each desk, and daily reminders for ones stuck too long.
 * Reminder threshold: IPC_REMINDER_DAYS (default 3). Runs every day at 09:00 AM Asia/Karachi.
 */
const cron = require('node-cron');
const ProjectInvoice = require('../models/projectManagement/ProjectInvoice');
const User = require('../models/User');
const { createAndEmitNotification } = require('../services/realtimeNotificationService');

const DESKS = [
  { status: 'Draft', label: 'Project team (to submit)' },
  { status: 'Pending Audit', label: 'Pre-Audit', roles: ['audit_manager', 'auditor'], url: '/audit/pre-audit' },
  { status: 'Forwarded to Audit Director', label: 'Audit Director', roles: ['audit_director'], url: '/audit/pre-audit' },
  { status: 'Send to CEO Office', label: 'CEO Secretariat (PS)', roles: ['hr_manager'], url: '/general/ceo-secretariat/payments' },
  { status: 'Forwarded to CEO', label: 'CEO', roles: ['higher_management', 'ceo'], url: '/dashboard' },
  { status: 'Rejected', label: 'Project team (to revise)' }
];
const DAY = 24 * 60 * 60 * 1000;
const reminderDays = () => Math.max(1, Number(process.env.IPC_REMINDER_DAYS) || 3);

/** When the IPC entered its current status (last history move into it; submission / creation as fallback) */
const enteredCurrentStatusAt = (inv) => {
  const st = inv.approvalStatus || 'Draft';
  const hist = inv.workflowHistory || [];
  for (let i = hist.length - 1; i >= 0; i -= 1) {
    if (hist[i].toStatus === st && hist[i].fromStatus !== st) return new Date(hist[i].changedAt);
  }
  return new Date(st === 'Draft' ? inv.createdAt : inv.submittedAt || inv.updatedAt || inv.createdAt);
};

/**
 * Time spent at each desk, from workflow history: a visit starts when the IPC moves into a status and ends
 * when it moves out. Open visits (still waiting) count up to now.
 */
const deskVisits = (inv) => {
  const hist = (inv.workflowHistory || []).filter((h) => h.fromStatus !== h.toStatus);
  const visits = [];
  let current = { status: 'Draft', from: new Date(inv.createdAt) };
  hist.forEach((h) => {
    const at = new Date(h.changedAt);
    if (current) visits.push({ status: current.status, from: current.from, to: at });
    current = h.toStatus === 'Approved' ? null : { status: h.toStatus, from: at };
  });
  if (current && inv.status !== 'Cancelled') visits.push({ status: current.status, from: current.from, to: null });
  return visits;
};

/** Average days per desk (completed visits in the window) + IPCs waiting now, longest first */
const buildDeskReport = async ({ sinceDays = 180 } = {}) => {
  const since = new Date(Date.now() - sinceDays * DAY);
  const ipcs = await ProjectInvoice.find({ invoiceType: 'Subcontractor_IPC', createdAt: { $gte: since } })
    .populate('contractor', 'name')
    .populate({ path: 'project', select: 'name parentProject', populate: { path: 'parentProject', select: 'name' } })
    .select('invoiceNumber ipcNumber ipcKind approvalStatus status netPayableAmount workflowHistory createdAt submittedAt updatedAt project contractor')
    .lean();

  const totals = new Map(DESKS.map((d) => [d.status, { days: 0, count: 0, max: 0 }]));
  ipcs.forEach((inv) => deskVisits(inv).forEach((v) => {
    if (!v.to || !totals.has(v.status)) return;
    const days = (v.to - v.from) / DAY;
    const t = totals.get(v.status);
    t.days += days; t.count += 1; t.max = Math.max(t.max, days);
  }));

  const now = Date.now();
  const waiting = ipcs
    .filter((inv) => inv.status !== 'Cancelled' && (inv.approvalStatus || 'Draft') !== 'Approved')
    .map((inv) => {
      const since = enteredCurrentStatusAt(inv);
      return {
        _id: inv._id,
        invoiceNumber: inv.invoiceNumber,
        ipcNumber: inv.ipcNumber,
        ipcKind: inv.ipcKind || 'Work',
        contractor: inv.contractor?.name,
        project: inv.project,
        netPayableAmount: inv.netPayableAmount,
        approvalStatus: inv.approvalStatus || 'Draft',
        desk: DESKS.find((d) => d.status === (inv.approvalStatus || 'Draft'))?.label || inv.approvalStatus,
        since,
        daysWaiting: Math.round(((now - since) / DAY) * 10) / 10
      };
    })
    .sort((a, b) => b.daysWaiting - a.daysWaiting);

  return {
    sinceDays,
    reminderDays: reminderDays(),
    desks: DESKS.map((d) => {
      const t = totals.get(d.status);
      return {
        status: d.status,
        label: d.label,
        completedVisits: t.count,
        averageDays: t.count ? Math.round((t.days / t.count) * 10) / 10 : null,
        maxDays: t.count ? Math.round(t.max * 10) / 10 : null,
        waitingNow: waiting.filter((w) => w.approvalStatus === d.status).length
      };
    }),
    waiting
  };
};

const userIdsByRoles = async (roles) =>
  (await User.find({ isActive: true, role: { $in: [...roles, 'admin', 'super_admin'] } }).select('_id').lean()).map((u) => String(u._id));

/** Remind each desk (and the initiator for Draft / Rejected) about IPCs waiting longer than the threshold, at most once a day */
const runIpcReminderSweep = async () => {
  try {
    const threshold = reminderDays() * DAY;
    const now = Date.now();
    const open = await ProjectInvoice.find({
      invoiceType: 'Subcontractor_IPC',
      status: { $ne: 'Cancelled' },
      approvalStatus: { $in: DESKS.map((d) => d.status) },
      $or: [{ lastReminderAt: null }, { lastReminderAt: { $lt: new Date(now - DAY + 60 * 60 * 1000) } }]
    }).select('invoiceNumber ipcNumber approvalStatus workflowHistory createdAt submittedAt updatedAt createdBy submittedBy project lastReminderAt');

    let sent = 0;
    for (const inv of open) {
      const days = (now - enteredCurrentStatusAt(inv)) / DAY;
      if (days * DAY < threshold) continue;
      const desk = DESKS.find((d) => d.status === inv.approvalStatus);
      const recipients = desk.roles
        ? await userIdsByRoles(desk.roles)
        : [inv.createdBy, inv.submittedBy].filter(Boolean).map(String);
      if (!recipients.length) continue;
      await createAndEmitNotification({
        recipientIds: [...new Set(recipients)],
        title: `IPC ${inv.invoiceNumber} waiting ${Math.floor(days)} days with ${desk.label}`,
        message: desk.roles
          ? `Subcontractor IPC #${inv.ipcNumber} has been waiting since ${enteredCurrentStatusAt(inv).toDateString()}. Please approve or reject it.`
          : `Your IPC #${inv.ipcNumber} is ${inv.approvalStatus === 'Rejected' ? 'rejected and waiting for revision' : 'still a draft'} — please ${inv.approvalStatus === 'Rejected' ? 'revise and resubmit' : 'submit'} it.`,
        type: 'warning',
        category: 'approval',
        priority: days >= reminderDays() * 2 ? 'high' : 'medium',
        actionUrl: desk.url || `/general/project-management/${inv.project}?tab=invoices`,
        entityId: inv._id,
        entityType: 'ProjectInvoice',
        module: 'project_management'
      }).catch((e) => console.error('[IPC reminders] notify failed:', e.message));
      inv.lastReminderAt = new Date();
      await inv.save();
      sent += 1;
    }
    if (sent) console.log(`[IPC reminders] ${sent} reminder(s) sent`);
    return { sent };
  } catch (err) {
    console.error('[IPC reminders] sweep failed:', err.message);
    return { sent: 0, error: err.message };
  }
};

const startIpcReminderCron = () => {
  cron.schedule('0 9 * * *', runIpcReminderSweep, { timezone: 'Asia/Karachi' });
  console.log(`✅ IPC approval reminder cron started (09:00 AM PKT daily, after ${reminderDays()} days at a desk)`);
};

module.exports = { buildDeskReport, runIpcReminderSweep, startIpcReminderCron, deskVisits, enteredCurrentStatusAt };
