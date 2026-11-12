const KPIWorksheet = require('../models/hr/KPIWorksheet');
const Employee = require('../models/hr/Employee');
const {
  findCatalogEntryForTitle,
  worksheetRowsFromCatalogEntry
} = require('./blueCollarKpiCatalog');
const { findCompanyDesignationPack, worksheetRowsFromPack } = require('./companyDesignationKpiCatalog');

function prevYearMonth(year, month) {
  if (month <= 1) return { year: year - 1, month: 12 };
  return { year, month: month - 1 };
}

/**
 * Clone KPI names + weights only; reset counts for new month.
 */
function cloneRowsFromWorksheet(prev) {
  if (!prev?.rows?.length) return [];
  return prev.rows.map((r) => ({
    kpiArea: r.kpiArea || '',
    weight: Number(r.weight) || 0,
    employeeAchieved: 0,
    employeeTotalAssigned: 0,
    managerAchieved: 0,
    managerTotalAssigned: 0,
    achieved: 0,
    totalAssigned: 0,
    achievementPercent: 0,
    score1to5: 1,
    finalWeightage: 0
  }));
}

function nextYearMonth(year, month) {
  if (month >= 12) return { year: year + 1, month: 1 };
  return { year, month: month + 1 };
}

/** KPI names + weights only, as a comparable key. */
function structureKey(rows) {
  return (rows || [])
    .map((r) => `${String(r.kpiArea || '').trim()}|${Number(r.weight) || 0}`)
    .join('\n');
}

function sheetHasMarks(sheet) {
  return (sheet?.rows || []).some(
    (r) =>
      (Number(r.employeeAchieved) || 0) > 0 ||
      (Number(r.employeeTotalAssigned) || 0) > 0 ||
      (Number(r.managerAchieved) || 0) > 0 ||
      (Number(r.managerTotalAssigned) || 0) > 0 ||
      (Number(r.achieved) || 0) > 0 ||
      (Number(r.totalAssigned) || 0) > 0
  );
}

/**
 * After KPI names/weights change on a sheet, carry them into the following months' sheets
 * that already exist (e.g. created by the monthly cron before the edit). A following sheet is
 * only replaced while it is still an untouched copy: no marks entered and the same KPIs the
 * edited sheet had before the edit. Stops at the first sheet that doesn't qualify.
 */
async function propagateStructureForward(source, oldRows) {
  const oldKey = structureKey(oldRows);
  const newKey = structureKey(source.rows);
  if (oldKey === newKey) return 0;

  let { year, month } = nextYearMonth(source.year, source.month);
  let updated = 0;
  for (;;) {
    const next = await KPIWorksheet.findOne({ employee: source.employee, year, month });
    if (!next || sheetHasMarks(next) || structureKey(next.rows) !== oldKey) break;

    next.rows = cloneRowsFromWorksheet(source);
    await next.save();
    updated += 1;
    ({ year, month } = nextYearMonth(year, month));
  }
  return updated;
}

/**
 * Default rows for blue-collar employees from designation KPI catalog.
 */
async function rowsFromBlueCollarDesignation(employeeId) {
  const emp = await Employee.findById(employeeId)
    .select('employeeCategory position placementDesignation placementCompany')
    .populate('placementDesignation', 'title')
    .populate('placementCompany', 'name')
    .lean();
  if (!emp) return [];

  const category = String(emp.employeeCategory || '').toLowerCase();
  // Prefer explicit blue_collar; also allow designation match when category unset
  const desigTitle = emp.placementDesignation?.title || emp.position || '';

  // Company-specific designation packs (e.g. TIGES / The Tenacious teachers) apply to any category
  const pack = findCompanyDesignationPack(emp.placementCompany?.name, desigTitle);
  if (pack) return worksheetRowsFromPack(pack);

  const entry = findCatalogEntryForTitle(desigTitle);
  if (!entry) return [];

  if (category && category !== 'blue_collar') {
    // White-collar should not auto-get these packs even if title loosely matches
    return [];
  }

  return worksheetRowsFromCatalogEntry(entry);
}

/** Rows for a sheet that has none yet: previous month's KPIs, else the designation catalog. */
async function defaultRowsForMonth(employeeId, year, month) {
  const { year: py, month: pm } = prevYearMonth(year, month);
  const prev = await KPIWorksheet.findOne({ employee: employeeId, year: py, month: pm }).lean();
  const rows = prev ? cloneRowsFromWorksheet(prev) : [];
  return rows.length ? rows : rowsFromBlueCollarDesignation(employeeId);
}

/**
 * A sheet created before the previous month had KPIs (e.g. by the monthly cron) stays empty;
 * fill it once the previous month has them. Returns true when rows were added.
 */
async function fillEmptyWorksheet(doc) {
  if (doc.rows?.length) return false;
  const rows = await defaultRowsForMonth(doc.employee, doc.year, doc.month);
  if (!rows.length) return false;
  doc.rows = rows;
  await doc.save();
  return true;
}

async function getOrCreateWorksheet(employeeId, year, month) {
  let doc = await KPIWorksheet.findOne({ employee: employeeId, year, month });
  if (doc) {
    await fillEmptyWorksheet(doc);
    return doc;
  }

  doc = await KPIWorksheet.create({
    employee: employeeId,
    year,
    month,
    rows: await defaultRowsForMonth(employeeId, year, month)
  });
  return doc;
}

/**
 * Called by cron on 1st of month: ensure every active employee has a worksheet for (year, month),
 * and fill sheets that are still empty from the previous month.
 */
async function ensureWorksheetsForMonth(year, month) {
  const employees = await Employee.find({
    isActive: true,
    isDeleted: { $ne: true }
  })
    .select('_id')
    .lean();

  let created = 0;
  let filled = 0;
  for (const e of employees) {
    const doc = await KPIWorksheet.findOne({ employee: e._id, year, month });
    if (!doc) {
      await getOrCreateWorksheet(e._id, year, month);
      created += 1;
    } else if (await fillEmptyWorksheet(doc)) {
      filled += 1;
    }
  }
  return { employees: employees.length, created, filled };
}

/**
 * Backfill empty current-month sheets for blue-collar employees from designation catalog.
 */
async function backfillEmptyBlueCollarWorksheets(year, month) {
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
    .select('_id employeeCategory position placementDesignation')
    .populate('placementDesignation', 'title')
    .lean();

  let updated = 0;
  for (const emp of employees) {
    const desigTitle = emp.placementDesignation?.title || emp.position || '';
    const entry = findCatalogEntryForTitle(desigTitle);
    if (!entry) continue;

    const sheet = await KPIWorksheet.findOne({ employee: emp._id, year, month });
    if (!sheet) {
      await getOrCreateWorksheet(emp._id, year, month);
      updated += 1;
      continue;
    }
    if (Array.isArray(sheet.rows) && sheet.rows.length > 0) continue;

    sheet.rows = worksheetRowsFromCatalogEntry(entry);
    sheet.recomputeDerived?.();
    await sheet.save();
    updated += 1;
  }
  return { scanned: employees.length, updated };
}

module.exports = {
  getOrCreateWorksheet,
  ensureWorksheetsForMonth,
  prevYearMonth,
  cloneRowsFromWorksheet,
  propagateStructureForward,
  rowsFromBlueCollarDesignation,
  backfillEmptyBlueCollarWorksheets
};
