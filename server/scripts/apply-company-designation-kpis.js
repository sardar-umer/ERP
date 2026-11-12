/**
 * Put the company designation KPI packs (server/data/companyDesignationKpis.json — e.g. TIGES / The Tenacious
 * teachers & lecturers) on the given months' KPI worksheets.
 *
 * Only worksheets with NO KPI rows yet are filled (a missing sheet is created). Sheets that already have KPIs
 * — e.g. someone set their own — are left exactly as they are and listed.
 *
 * Usage:
 *   node server/scripts/apply-company-designation-kpis.js --months 2026-10,2026-11            # dry run
 *   node server/scripts/apply-company-designation-kpis.js --months 2026-10,2026-11 --apply
 */
const path = require('path');
const fsSync = require('fs');

const repoRoot = path.join(__dirname, '..', '..');
const envPath = path.join(repoRoot, '.env');
const localPath = path.join(repoRoot, '.env.local');
if (!process.env.MONGODB_URI && fsSync.existsSync(envPath)) require('dotenv').config({ path: envPath });
if (!process.env.MONGODB_URI && fsSync.existsSync(localPath)) require('dotenv').config({ path: localPath, override: true });

const { connectDB, disconnectDB } = require('../config/database');
const Employee = require('../models/hr/Employee');
require('../models/hr/Designation');
require('../models/hr/Company'); // registers PlacementCompany
const KPIWorksheet = require('../models/hr/KPIWorksheet');
const { findCompanyDesignationPack, worksheetRowsFromPack } = require('../utils/companyDesignationKpiCatalog');

const argValue = (name) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : null;
};

async function main() {
  const apply = process.argv.includes('--apply');
  const months = String(argValue('--months') || '')
    .split(',').map((s) => s.trim()).filter(Boolean)
    .map((s) => { const [y, m] = s.split('-').map(Number); return { year: y, month: m }; })
    .filter((p) => p.year > 2000 && p.month >= 1 && p.month <= 12);
  if (!months.length) throw new Error('Give the months, e.g. --months 2026-10,2026-11');

  await connectDB();
  console.log(`${apply ? 'APPLYING' : 'DRY RUN'} for ${months.map((p) => `${p.year}-${String(p.month).padStart(2, '0')}`).join(', ')}\n`);

  const employees = await Employee.find({ isActive: true, isDeleted: { $ne: true } })
    .select('_id employeeId firstName lastName position placementDesignation placementCompany')
    .populate('placementDesignation', 'title')
    .populate('placementCompany', 'name')
    .lean();

  const totals = { filled: 0, created: 0, kept: 0 };
  for (const emp of employees) {
    const title = emp.placementDesignation?.title || emp.position || '';
    const pack = findCompanyDesignationPack(emp.placementCompany?.name, title);
    if (!pack) continue;
    const who = `${emp.employeeId || emp._id} ${[emp.firstName, emp.lastName].filter(Boolean).join(' ')} — ${title} (${emp.placementCompany?.name})`;

    for (const { year, month } of months) {
      const tag = `${year}-${String(month).padStart(2, '0')}`;
      const sheet = await KPIWorksheet.findOne({ employee: emp._id, year, month });
      if (sheet && sheet.rows?.length) {
        totals.kept += 1;
        console.log(`  kept (already has ${sheet.rows.length} KPIs) ${tag}: ${who}`);
        continue;
      }
      if (sheet) {
        totals.filled += 1;
        if (apply) {
          sheet.rows = worksheetRowsFromPack(pack);
          sheet.recomputeDerived?.();
          await sheet.save();
        }
      } else {
        totals.created += 1;
        if (apply) await KPIWorksheet.create({ employee: emp._id, year, month, rows: worksheetRowsFromPack(pack) });
      }
      console.log(`  ${apply ? '' : 'would '}${sheet ? 'fill' : 'create'} ${tag}: ${who}`);
    }
  }

  console.log(`\n${apply ? 'Filled' : 'To fill'}: ${totals.filled}, ${apply ? 'created' : 'to create'}: ${totals.created}, kept (already had KPIs): ${totals.kept}`);
  if (!apply) console.log('Dry run only — re-run with --apply to write.');
}

main()
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(async () => { try { await disconnectDB(); } catch (_) { /* ignore */ } });
