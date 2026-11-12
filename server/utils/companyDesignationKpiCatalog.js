/**
 * Company-specific designation KPI packs (server/data/companyDesignationKpis.json), e.g. the Teacher /
 * Lecturer KPIs of TIGES and The Tenacious. Unlike the blue-collar catalog these apply whatever the
 * employee's category is, but only to employees of the listed companies whose designation matches.
 */
const packs = require('../data/companyDesignationKpis.json');

const norm = (v) => String(v || '').toLowerCase().replace(/\s+/g, ' ').trim();

const getPacks = () => (Array.isArray(packs) ? packs : []);

/** Pack for an employee of `companyName` with designation `title`, or null */
const findCompanyDesignationPack = (companyName, title) => {
  const company = norm(companyName);
  const t = norm(title);
  if (!company || !t) return null;
  return getPacks().find((p) => (p.companies || []).some((c) => norm(c) === company)
    && new RegExp(p.titlePattern, 'i').test(t)) || null;
};

/** KPI name and target together, so the target shows on the worksheet row */
const rowTitle = (item) => (item.target ? `${item.kpi} — ${item.target}` : item.kpi);

const worksheetRowsFromPack = (pack) => (pack?.items || []).map((item) => ({
  kpiArea: rowTitle(item),
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

module.exports = { getPacks, findCompanyDesignationPack, worksheetRowsFromPack };
