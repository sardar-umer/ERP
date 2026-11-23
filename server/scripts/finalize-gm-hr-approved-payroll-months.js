#!/usr/bin/env node
/**
 * One-time helper after AVP was removed from the payroll approval chain (2026-11-23).
 *
 * A month that GM HR had already approved while it was still waiting for AVP is now finished
 * (GM HR is the final approver), but the steps that used to run on AVP's approval never ran:
 *   - monthly approval authorityStatus -> 'approved'
 *   - payroll + comparison report approvedBy / approvedAt (GM HR's approval)
 *   - employee arrears marked paid for that period
 *   - "Monthly payroll ready for Finance" notification
 *
 * Usage:
 *   NODE_ENV=production node server/scripts/finalize-gm-hr-approved-payroll-months.js           # dry run
 *   NODE_ENV=production node server/scripts/finalize-gm-hr-approved-payroll-months.js --apply   # write
 *   ... --month=11 --year=2026   (limit to one period)
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const mongoose = require('mongoose');
const { getMongooseClientOptions } = require('../config/database');

const apply = process.argv.includes('--apply');
const argNum = (name) => {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a ? Number(a.split('=')[1]) : null;
};
const onlyMonth = argNum('month');
const onlyYear = argNum('year');

(async () => {
  const uri = process.env.MONGODB_URI || process.env.MONGODB_URI_LOCAL;
  await mongoose.connect(uri, getMongooseClientOptions(uri, /localhost|127/.test(uri || '')));

  require('../models/hr/Employee');
  require('../models/User');
  const Payroll = require('../models/hr/Payroll');
  const PayrollMonthlyApproval = require('../models/hr/PayrollMonthlyApproval');
  const PayrollMonthlyComparisonReport = require('../models/hr/PayrollMonthlyComparisonReport');
  const User = mongoose.model('User');
  const { syncAuthorityStatus, FINAL_PAYROLL_AUTHORITY_KEY } = require('../utils/payrollMonthlyApproval');
  const { markEmployeeArrearsPaidForPeriod } = require('../utils/employeeArrearsUpdate');
  const { MONTH_NAMES } = require('../utils/financePayrollQueue');

  const filter = { authorityStatus: { $ne: 'approved' } };
  if (onlyMonth) filter.month = onlyMonth;
  if (onlyYear) filter.year = onlyYear;
  const docs = await PayrollMonthlyApproval.find(filter).sort({ year: 1, month: 1 });

  const results = [];
  for (const doc of docs) {
    const finalApproval = (doc.financeAuthorityApprovals || []).find(
      (a) => a.authorityKey === FINAL_PAYROLL_AUTHORITY_KEY && String(a.decision || 'approved') !== 'rejected'
    );
    if (!finalApproval) continue; // GM HR has not approved yet — the normal flow will finish it

    const payrolls = await Payroll.find({ month: doc.month, year: doc.year, status: 'Approved by GM HR' })
      .select('_id arrears employee approvedAt');
    const comparison = await PayrollMonthlyComparisonReport.findOne({ month: doc.month, year: doc.year })
      .select('status approvedAt');

    const row = {
      period: `${doc.month}/${doc.year}`,
      gmHrApprovedAt: finalApproval.approvedAt,
      payrollsToFinalize: payrolls.filter((p) => !p.approvedAt).length,
      payrollsWithArrears: payrolls.filter((p) => Number(p.arrears) > 0).length,
      comparisonStatus: comparison?.status || null
    };
    results.push(row);
    if (!apply) continue;

    syncAuthorityStatus(doc);
    await doc.save();

    await Payroll.updateMany(
      { _id: { $in: payrolls.filter((p) => !p.approvedAt).map((p) => p._id) } },
      { $set: { approvedBy: finalApproval.approver, approvedAt: finalApproval.approvedAt || new Date() } }
    );
    for (const p of payrolls) {
      if (Number(p.arrears) > 0) await markEmployeeArrearsPaidForPeriod(p.employee, doc.month, doc.year);
    }
    if (comparison && comparison.status === 'Approved by GM HR' && !comparison.approvedAt) {
      await PayrollMonthlyComparisonReport.updateOne(
        { _id: comparison._id },
        { $set: { approvedBy: finalApproval.approver, approvedAt: finalApproval.approvedAt || new Date() } }
      );
    }

    try {
      const { createAndEmitNotification } = require('../services/realtimeNotificationService');
      const financeUsers = await User.find({ role: { $in: ['finance_manager', 'admin', 'super_admin'] }, isActive: true })
        .select('_id').lean();
      if (financeUsers.length) {
        await createAndEmitNotification({
          recipientIds: financeUsers.map((u) => u._id),
          actorId: finalApproval.approver,
          title: 'Monthly payroll ready for Finance',
          message: `${MONTH_NAMES[doc.month]} ${doc.year} payroll and comparison report are approved by GM HR. Process salary payment and bank letter.`,
          type: 'info',
          category: 'approval',
          priority: 'high',
          actionUrl: `/finance/payroll-queue?month=${doc.month}&year=${doc.year}`,
          metadata: { module: 'finance', entityType: 'PayrollMonthlyApproval', month: doc.month, year: doc.year }
        });
      }
    } catch (e) {
      console.warn(`Notification skipped for ${row.period}: ${e.message}`);
    }
    row.applied = true;
  }

  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', months: results }, null, 2));
  if (!results.length) console.log('No GM HR-approved months are waiting on AVP. Nothing to do.');
  await mongoose.disconnect();
})().catch(async (e) => {
  console.error(e);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
