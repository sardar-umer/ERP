#!/usr/bin/env node
/**
 * One-time helper after Audit was removed from the Manual Salary chain (2026-11-23: GM HR → Finance).
 * Moves Manual Salary records still waiting in the Audit queue (Pending Audit / Forwarded to Audit Director /
 * old-flow Approved by CEO) to Pending Finance, with a history note, and notifies Finance once.
 *
 * Usage:
 *   NODE_ENV=production node server/scripts/move-manual-salary-audit-queue-to-finance.js           # dry run (lists only)
 *   NODE_ENV=production node server/scripts/move-manual-salary-audit-queue-to-finance.js --apply   # move them
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const mongoose = require('mongoose');
const { getMongooseClientOptions } = require('../config/database');

const apply = process.argv.includes('--apply');
const AUDIT_QUEUE = ['Pending Audit', 'Forwarded to Audit Director', 'Approved by CEO'];

(async () => {
  const uri = process.env.MONGODB_URI || process.env.MONGODB_URI_LOCAL;
  await mongoose.connect(uri, getMongooseClientOptions(uri, /localhost|127/.test(uri || '')));
  require('../models/User');
  const ManualSalary = require('../models/hr/ManualSalary');

  const records = await ManualSalary.find({ workflowStatus: { $in: AUDIT_QUEUE } })
    .select('name empId month year netPayable workflowStatus companyName');
  const rows = records.map((r) => ({
    id: String(r._id),
    name: r.name,
    empId: r.empId || '',
    period: `${r.month}/${r.year}`,
    netPayable: r.netPayable,
    company: r.companyName || '',
    status: r.workflowStatus
  }));

  if (apply && records.length) {
    for (const r of records) {
      const from = r.workflowStatus;
      r.workflowStatus = 'Pending Finance';
      r.workflowHistory = r.workflowHistory || [];
      r.workflowHistory.push({
        fromStatus: from,
        toStatus: 'Pending Finance',
        changedBy: null,
        changedAt: new Date(),
        comments: 'Audit removed from the Manual Salary chain — moved to Finance',
        module: 'System'
      });
      await r.save();
    }
    try {
      const { createAndEmitNotification } = require('../services/realtimeNotificationService');
      const User = mongoose.model('User');
      const finance = await User.find({ isActive: true, role: { $in: ['finance_manager', 'admin', 'super_admin'] } }).select('_id').lean();
      if (finance.length) {
        await createAndEmitNotification({
          recipientIds: finance.map((u) => String(u._id)),
          title: 'Manual salaries ready for payment',
          message: `${records.length} manual salary record(s) moved from Audit to Finance → Payroll → Manual Salary.`,
          type: 'info',
          category: 'approval',
          priority: 'medium',
          actionUrl: '/finance/payroll',
          metadata: { module: 'hr', entityType: 'ManualSalary' }
        });
      }
    } catch (e) {
      console.warn('Notification skipped:', e.message);
    }
  }

  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', count: rows.length, records: rows }, null, 2));
  if (!rows.length) console.log('No Manual Salary records are waiting in Audit. Nothing to do.');
  await mongoose.disconnect();
})().catch(async (e) => {
  console.error(e);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
