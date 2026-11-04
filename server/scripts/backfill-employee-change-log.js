#!/usr/bin/env node
/**
 * Rebuild the Employee change log (transfers, designation changes, salary / allowance / status edits, …)
 * for edits made BEFORE change tracking existed, from the audit trail.
 *
 * Every HR employee edit (PUT /api/hr/employees/:id) is stored in the audit trail with the full form body,
 * the user and the time. Consecutive bodies of the same employee are compared field by field; each edit
 * that changed a tracked field becomes one EmployeeChangeLog entry (source "audit") dated at the edit.
 * The first audited edit of an employee is compared with the form body of the employee's creation
 * (POST /api/hr/employees) when the audit trail has it; otherwise it is the baseline and is not logged.
 *
 * Safe to run more than once: edits already rebuilt (same employee + time, source "audit") are skipped.
 *
 * Usage:
 *   node server/scripts/backfill-employee-change-log.js            # dry run — lists what would be written
 *   node server/scripts/backfill-employee-change-log.js --apply
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const mongoose = require('mongoose');
const { getMongooseClientOptions } = require('../config/database');

const apply = process.argv.includes('--apply');

(async () => {
  const uri = process.env.MONGODB_URI || process.env.MONGODB_URI_LOCAL;
  await mongoose.connect(uri, getMongooseClientOptions(uri, /localhost|127/.test(uri || '')));

  ['Company', 'Sector', 'Project', 'Department', 'Section', 'Designation', 'Location', 'Position', 'Employee']
    .forEach((m) => require(`../models/hr/${m}`));
  require('../models/User');
  const EmployeeChangeLog = require('../models/hr/EmployeeChangeLog');
  const { diffSnapshots, getPath, TRACKED_PATHS } = require('../utils/employeeChangeTracking');
  const audits = mongoose.connection.db.collection('audittrails');

  const edits = await audits.find({
    requestMethod: 'PUT',
    requestUrl: { $regex: '^/api/hr/employees/[0-9a-fA-F]{24}$' },
    status: { $ne: 'failure' },
    requestBody: { $type: 'object' }
  }).sort({ timestamp: 1 }).project({ requestUrl: 1, requestBody: 1, userId: 1, timestamp: 1 }).toArray();

  const creations = await audits.find({
    requestMethod: 'POST',
    requestUrl: { $regex: '^/api/hr/employees/?$' },
    status: { $ne: 'failure' },
    requestBody: { $type: 'object' }
  }).project({ requestBody: 1, timestamp: 1 }).toArray();
  const createdByEmpNo = new Map();
  creations.forEach((c) => {
    const no = String(c.requestBody?.employeeId || '').trim();
    if (no) createdByEmpNo.set(no, c.requestBody);
  });

  const byEmployee = new Map();
  edits.forEach((e) => {
    const id = e.requestUrl.split('/').pop();
    if (!byEmployee.has(id)) byEmployee.set(id, []);
    byEmployee.get(id).push(e);
  });

  let employees = 0;
  let entries = 0;
  let skipped = 0;
  const fieldCounts = {};
  for (const [employeeId, list] of byEmployee) {
    let previous = createdByEmpNo.get(String(list[0].requestBody?.employeeId || '').trim()) || null;
    let wrote = 0;
    for (const edit of list) {
      const body = edit.requestBody;
      if (previous) {
        // Only fields the form actually sent are compared (a field missing from a body is not a change)
        const paths = TRACKED_PATHS.filter((p) => getPath(body, p) !== undefined && getPath(previous, p) !== undefined);
        const changes = await diffSnapshots(previous, body, paths);
        if (changes.length) {
          const exists = await EmployeeChangeLog.exists({ employee: employeeId, changedAt: edit.timestamp, source: 'audit' });
          if (exists) {
            skipped += 1;
          } else {
            entries += 1;
            wrote += 1;
            changes.forEach((c) => { fieldCounts[c.label] = (fieldCounts[c.label] || 0) + 1; });
            if (!apply && entries <= 15) {
              console.log(`${new Date(edit.timestamp).toISOString().slice(0, 16)} ${employeeId}: ${changes.map((c) => `${c.label} ${c.from || '—'} → ${c.to || '—'}`).join('; ')}`);
            }
            if (apply) {
              await EmployeeChangeLog.create({
                employee: employeeId,
                changedBy: edit.userId || null,
                changedAt: edit.timestamp,
                source: 'audit',
                changes
              });
            }
          }
        }
      }
      // Carry forward fields this body did not send, so the next comparison has them
      previous = { ...(previous || {}), ...body };
    }
    if (wrote) employees += 1;
  }

  console.log(JSON.stringify({
    mode: apply ? 'APPLIED' : 'DRY RUN',
    auditedEdits: edits.length,
    employeesWithEdits: byEmployee.size,
    employeesWithChanges: employees,
    entries,
    alreadyRebuilt: skipped,
    changesByField: fieldCounts
  }, null, 2));
  if (!apply) console.log('Dry run only — re-run with --apply to write the change log.');
  await mongoose.disconnect();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
