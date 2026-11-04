/**
 * Blue-collar designation KPI catalog (from docs/All_Designation_KPI.docx).
 * Matching is by designation / position title.
 */
const catalog = require('../data/blueCollarDesignationKpis.json');

const normalizeTitle = (value) => String(value || '')
  .toLowerCase()
  .replace(/[/&,()-]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const inferCalculationRule = (calculation = '', target = '') => {
  const blob = `${calculation} ${target}`.toLowerCase();
  if (blob.includes('compliance')) return 'compliance';
  if (blob.includes('time lower better')) return 'time_lower_better';
  if (blob.includes('lower better')) return 'lower_better';
  return 'higher_better';
};

const getCatalogEntries = () => (Array.isArray(catalog) ? catalog : []);

/**
 * Resolve catalog pack for an employee designation/position string.
 * Prefers exact match, then contains either way (e.g. Driver ↔ Driver / HTV Driver).
 */
const TITLE_ALIASES = {
  masson: 'mason',
  // "Guard" in the system is a Security Guard — use the Security Guard KPIs from HR's document
  guard: 'security guard',
  'security gaurd': 'security guard',
  gaurd: 'security guard',
  driver: 'driver / htv driver',
  'htv driver': 'driver / htv driver',
  // Loose "driver" matches would otherwise prefer the longer Executive Protection Driver pack
  'dumper driver': 'driver / htv driver',
  rikshaw: 'rikshaw driver',
  rickshaw: 'rikshaw driver',
  'rickshaw driver': 'rikshaw driver'
};

const findCatalogEntryForTitle = (title) => {
  let needle = normalizeTitle(title);
  if (!needle) return null;
  if (TITLE_ALIASES[needle]) needle = normalizeTitle(TITLE_ALIASES[needle]);
  const entries = getCatalogEntries();

  const exact = entries.find((e) => normalizeTitle(e.designation) === needle);
  if (exact) return exact;

  const aliases = needle.split(/\s+/).filter(Boolean);
  // Prefer longer designation titles that contain the needle or vice versa
  const ranked = entries
    .map((e) => {
      const d = normalizeTitle(e.designation);
      let score = 0;
      if (d === needle) score = 100;
      else if (d.includes(needle) || needle.includes(d)) score = 80;
      else if (aliases.some((a) => a.length > 2 && d.includes(a))) score = 40;
      return { e, score, len: d.length };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || b.len - a.len);

  return ranked[0]?.e || null;
};

/** True when the title is the entry's own designation (or an alias of it), not a loose word match */
const isExactCatalogMatch = (title, entry) => {
  let needle = normalizeTitle(title);
  if (TITLE_ALIASES[needle]) needle = normalizeTitle(TITLE_ALIASES[needle]);
  return Boolean(entry) && needle === normalizeTitle(entry.designation);
};

const isBlueCollarEmployee = (employee) => {
  if (!employee) return false;
  if (String(employee.employeeCategory || '').toLowerCase() === 'blue_collar') return true;
  if (String(employee.employeeCategory || '').toLowerCase() === 'white_collar') return false;
  const title = employee.placementDesignation?.title || employee.positionTitle || employee.position || '';
  if (typeof title === 'object' && title?.title) return Boolean(findCatalogEntryForTitle(title.title));
  return Boolean(findCatalogEntryForTitle(title));
};

const catalogItemsToTemplateItems = (entry) => (entry?.items || []).map((item) => ({
  title: item.kpi,
  description: [item.details, item.target ? `Target: ${item.target}` : ''].filter(Boolean).join(' '),
  weight: Number(item.weight) || 0,
  target: item.target || '',
  calculationRule: inferCalculationRule(item.calculation, item.target),
  measurementType: 'percentage'
}));

const worksheetRowsFromCatalogEntry = (entry) => (entry?.items || []).map((item) => ({
  kpiArea: item.kpi,
  weight: Number(item.weight) || 0,
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

module.exports = {
  normalizeTitle,
  getCatalogEntries,
  findCatalogEntryForTitle,
  isExactCatalogMatch,
  catalogItemsToTemplateItems,
  worksheetRowsFromCatalogEntry,
  inferCalculationRule,
  isBlueCollarEmployee
};
