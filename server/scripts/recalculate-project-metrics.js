#!/usr/bin/env node
/**
 * Recalculate progress + spent on every construction project.
 *
 * Progress used to come from WBS task updates (no screen sets them any more) and spent
 * from Project Expenses (retired). Both now derive from Sublet Contracts, verified
 * Check Requests and Subcontractor IPCs — run this once so existing projects match.
 *
 * Usage:
 *   node server/scripts/recalculate-project-metrics.js            # dry run, prints changes
 *   node server/scripts/recalculate-project-metrics.js --apply
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const mongoose = require('mongoose');
const { getMongooseClientOptions } = require('../config/database');
const ConstructionProject = require('../models/projectManagement/ConstructionProject');
const { syncProjectMetrics, computeSubProjectMetrics } = require('../services/projectMetricsService');

const apply = process.argv.includes('--apply');

(async () => {
  const uri = process.env.MONGODB_URI || process.env.MONGODB_URI_LOCAL;
  await mongoose.connect(uri, getMongooseClientOptions(uri, /localhost|127/.test(uri || '')));

  const subs = await ConstructionProject.find({ parentProject: { $ne: null } })
    .select('name projectNumber parentProject status totalEstimatedCost overallProgress totalActualSpent')
    .lean();

  let changed = 0;
  for (const sub of subs) {
    const m = await computeSubProjectMetrics(sub);
    const differs = m.progress !== (sub.overallProgress || 0) || Math.round(m.spent) !== Math.round(sub.totalActualSpent || 0);
    if (!differs) continue;
    changed += 1;
    console.log(
      `${sub.projectNumber || sub._id} ${sub.name}: progress ${sub.overallProgress || 0}% → ${m.progress}%, ` +
      `spent ${sub.totalActualSpent || 0} → ${m.spent}`
    );
    if (apply) await syncProjectMetrics(sub._id);
  }

  if (apply) {
    // Mains with no Subs still need their rolled-up spent reset
    const mains = await ConstructionProject.find({ parentProject: null }).select('_id').lean();
    for (const main of mains) await syncProjectMetrics(main._id);
  }

  console.log(`\n${subs.length} Sub Projects checked, ${changed} ${apply ? 'updated' : 'would change'}.`);
  if (!apply && changed) console.log('Re-run with --apply to save.');
  await mongoose.disconnect();
})().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect();
  process.exit(1);
});
