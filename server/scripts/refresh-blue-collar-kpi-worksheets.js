/**
 * Replace the KPI rows on a month's worksheets with the current designation catalog
 * (server/data/blueCollarDesignationKpis.json) for the designations listed below.
 * Only sheets nobody has started (every Achieved / Total Assigned still 0) are changed;
 * later months clone these rows, so the new KPIs carry forward.
 *
 * Usage:
 *   node server/scripts/refresh-blue-collar-kpi-worksheets.js                 # dry run, current month
 *   node server/scripts/refresh-blue-collar-kpi-worksheets.js --apply
 *   node server/scripts/refresh-blue-collar-kpi-worksheets.js --year 2026 --month 12 --apply
 */
const path = require('path');
const fsSync = require('fs');

const repoRoot = path.join(__dirname, '..', '..');
const envPath = path.join(repoRoot, '.env');
const localPath = path.join(repoRoot, '.env.local');
if (fsSync.existsSync(envPath)) require('dotenv').config({ path: envPath });
if (fsSync.existsSync(localPath)) require('dotenv').config({ path: localPath, override: true });

const { connectDB, disconnectDB } = require('../config/database');
const Employee = require('../models/hr/Employee');
require('../models/hr/Designation');
const KPIWorksheet = require('../models/hr/KPIWorksheet');
const {
  findCatalogEntryForTitle,
  isExactCatalogMatch,
  worksheetRowsFromCatalogEntry
} = require('../utils/blueCollarKpiCatalog');

// Designations whose KPIs were updated from HR's KPI documents (Driver, Security Guard & Watchman,
// Office Boy & Janitor, Executive Protection Officer / Driver / Guard)
const UPDATED_DESIGNATIONS = [
  'Driver / HTV Driver',
  'Security Guard',
  'Watchman',
  'Office Boy',
  'Janitor',
  'Executive Protection Guard',
  'Executive Protection Officer',
  'Executive Protection Driver'
];

const COUNT_FIELDS = [
  'employeeAchieved', 'employeeTotalAssigned', 'managerAchieved', 'managerTotalAssigned', 'achieved', 'totalAssigned'
];

const argValue = (name) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? Number(process.argv[i + 1]) : null;
};

async function main() {
  const now = new Date();
  const year = argValue('--year') || now.getFullYear();
  const month = argValue('--month') || now.getMonth() + 1;
  const apply = process.argv.includes('--apply');
  await connectDB();
  console.log(`${apply ? 'APPLYING' : 'DRY RUN'} for ${year}-${String(month).padStart(2, '0')}\n`);

  const employees = await Employee.find({
    isActive: true,
    isDeleted: { $ne: true },
    $or: [
      { employeeCategory: 'blue_collar' },
      { employeeCategory: { $exists: false } },
      { employeeCategory: null },
      { employeeCategory: '' }
    ]
  })
    .select('_id employeeId firstName lastName position placementDesignation')
    .populate('placementDesignation', 'title')
    .lean();

  const summary = {};
  for (const emp of employees) {
    const title = emp.placementDesignation?.title || emp.position || '';
    const entry = findCatalogEntryForTitle(title);
    if (!entry || !UPDATED_DESIGNATIONS.includes(entry.designation) || !isExactCatalogMatch(title, entry)) continue;

    const s = summary[entry.designation] || (summary[entry.designation] = { refreshed: 0, started: 0, noSheet: 0 });
    const sheet = await KPIWorksheet.findOne({ employee: emp._id, year, month });
    if (!sheet) {
      s.noSheet += 1; // created from the catalog when the month's sheet is first opened / by the monthly cron
      continue;
    }
    const started = (sheet.rows || []).some((r) => COUNT_FIELDS.some((f) => Number(r[f]) > 0));
    if (started) {
      s.started += 1;
      console.log(`  kept (already started): ${emp.employeeId || emp._id} ${emp.firstName || ''} ${emp.lastName || ''} — ${title}`);
      continue;
    }
    s.refreshed += 1;
    if (apply) {
      sheet.rows = worksheetRowsFromCatalogEntry(entry);
      sheet.recomputeDerived?.();
      await sheet.save();
    }
  }

  console.log('');
  for (const designation of UPDATED_DESIGNATIONS) {
    const s = summary[designation] || { refreshed: 0, started: 0, noSheet: 0 };
    console.log(`${designation.padEnd(30)} ${apply ? 'refreshed' : 'to refresh'}: ${s.refreshed}, kept (already started): ${s.started}, no sheet yet: ${s.noSheet}`);
  }
  if (!apply) console.log('\nDry run only — re-run with --apply to update the worksheets.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    try { await disconnectDB(); } catch (_) { /* ignore */ }
  });
