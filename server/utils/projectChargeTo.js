/**
 * "Charged to" link between procurement and Project Management.
 *
 * An Indent can be raised for a Construction Project → Sub Project, with a budget category on each line
 * (the Sub Project's budget categories). The link is stored as `chargeTo` on the Indent and copied,
 * with each line's `budgetCategory`, to the Purchase Orders made from it and the GRNs made from those POs.
 * Department-only indents leave `chargeTo` empty and work as before.
 */
const mongoose = require('mongoose');

/** Schema for the `chargeTo` field on Indent / PurchaseOrder / GoodsReceive (names are kept as a snapshot) */
const chargeToSchema = new mongoose.Schema({
  project: { type: mongoose.Schema.Types.ObjectId, ref: 'ConstructionProject', default: null, index: true },
  projectName: { type: String, trim: true, default: '' },
  subProject: { type: mongoose.Schema.Types.ObjectId, ref: 'ConstructionProject', default: null, index: true },
  subProjectName: { type: String, trim: true, default: '' }
}, { _id: false });

const hasChargeTo = (doc) => Boolean(doc?.chargeTo?.project && doc?.chargeTo?.subProject);

const budgetCategories = () => require('../models/projectManagement/ConstructionProject').BUDGET_CATEGORIES;

const idOf = (v) => (v && typeof v === 'object' && v._id ? v._id : v);

/**
 * Normalise `chargeTo` / item `budgetCategory` in a request body before it reaches the model:
 * an empty project clears the whole link so '' never gets cast to an ObjectId.
 */
const normalizeChargeToBody = (body) => {
  if (!body || body.chargeTo === undefined) return;
  const ct = body.chargeTo && typeof body.chargeTo === 'object' ? body.chargeTo : {};
  const project = String(idOf(ct.project) || '').trim();
  const subProject = String(idOf(ct.subProject) || '').trim();
  if (!project) {
    body.chargeTo = { project: null, projectName: '', subProject: null, subProjectName: '' };
    if (Array.isArray(body.items)) body.items.forEach((it) => { if (it) it.budgetCategory = ''; });
    return;
  }
  body.chargeTo = { project, projectName: '', subProject: subProject || null, subProjectName: '' };
};

/**
 * Check the indent's project link and fill the name snapshot.
 * Returns an error message for the user, or null when the link is valid (or not set).
 */
const validateIndentChargeTo = async (indent) => {
  const ct = indent.chargeTo || {};
  if (!ct.project) {
    indent.chargeTo = { project: null, projectName: '', subProject: null, subProjectName: '' };
    (indent.items || []).forEach((it) => { it.budgetCategory = ''; });
    return null;
  }
  if (!mongoose.Types.ObjectId.isValid(String(ct.project))) return 'Select a valid project.';
  if (!ct.subProject) return 'Select the sub-project this indent is for.';
  if (!mongoose.Types.ObjectId.isValid(String(ct.subProject))) return 'Select a valid sub-project.';

  const ConstructionProject = mongoose.model('ConstructionProject');
  const [project, sub] = await Promise.all([
    ConstructionProject.findById(ct.project).select('name projectNumber parentProject').lean(),
    ConstructionProject.findById(ct.subProject).select('name projectNumber parentProject').lean()
  ]);
  if (!project || project.parentProject) return 'Selected project was not found.';
  if (!sub || String(sub.parentProject) !== String(project._id)) return 'Selected sub-project does not belong to this project.';

  const allowed = budgetCategories();
  const items = indent.items || [];
  for (let i = 0; i < items.length; i++) {
    const cat = String(items[i].budgetCategory || '').trim();
    if (!allowed.includes(cat)) return `Select a budget category for item ${i + 1}.`;
    items[i].budgetCategory = cat;
  }

  indent.chargeTo = {
    project: project._id,
    projectName: project.name || '',
    subProject: sub._id,
    subProjectName: sub.name || ''
  };
  return null;
};

const norm = (s) => String(s || '').trim().toLowerCase();

/**
 * Pick the budget category for a line from the source document's lines:
 * same catalog item first, then same name, then the only category used when all lines share one.
 */
const categoryFor = (line, sourceLines, { lineName, sourceName, lineCode, sourceCode }) => {
  const withCat = (sourceLines || []).filter((s) => s && s.budgetCategory);
  if (!withCat.length) return '';
  if (line.itemMaster) {
    const hit = withCat.find((s) => s.itemMaster && String(s.itemMaster) === String(line.itemMaster));
    if (hit) return hit.budgetCategory;
  }
  const code = norm(line[lineCode]);
  if (code) {
    const hit = withCat.find((s) => norm(s[sourceCode]) === code);
    if (hit) return hit.budgetCategory;
  }
  const name = norm(line[lineName]);
  if (name) {
    const hit = withCat.find((s) => norm(s[sourceName]) === name);
    if (hit) return hit.budgetCategory;
  }
  const cats = [...new Set(withCat.map((s) => s.budgetCategory))];
  return cats.length === 1 ? cats[0] : '';
};

/**
 * Copy `chargeTo` and per-line budget categories from a source document onto a target
 * (Indent → PO, PO → GRN). Lines that already have a category keep it.
 * `matchLine(sourceLines, line, index)` may return the source line index to take the category from.
 */
const inheritChargeTo = (target, source, names, matchLine = null) => {
  if (!hasChargeTo(source)) return false;
  const s = source.chargeTo;
  target.chargeTo = {
    project: s.project,
    projectName: s.projectName || '',
    subProject: s.subProject,
    subProjectName: s.subProjectName || ''
  };
  (target.items || []).forEach((line, i) => {
    if (line.budgetCategory) return;
    // When the caller knows exactly which source line this one comes from, use that line's category
    const j = matchLine ? matchLine(source.items || [], line, i) : -1;
    const matched = j >= 0 ? source.items[j]?.budgetCategory : '';
    line.budgetCategory = matched || categoryFor(line, source.items, names);
  });
  return true;
};

/**
 * Store business unit (HR / store "Project") for a Sub Project: set on its Main Project.
 * Returns { _id, name } or null when the Main Project is not linked.
 */
const resolveStoreProject = async (subProjectId) => {
  if (!subProjectId || !mongoose.Types.ObjectId.isValid(String(subProjectId))) return null;
  const ConstructionProject = mongoose.model('ConstructionProject');
  const sub = await ConstructionProject.findById(subProjectId).select('parentProject storeProject').lean();
  if (!sub) return null;
  const main = sub.parentProject
    ? await ConstructionProject.findById(sub.parentProject).select('storeProject').lean()
    : sub;
  if (!main?.storeProject) return null;
  const Project = require('../models/hr/Project');
  const unit = await Project.findById(main.storeProject).select('name').lean();
  return unit ? { _id: unit._id, name: unit.name } : null;
};

module.exports = {
  resolveStoreProject,
  chargeToSchema,
  hasChargeTo,
  normalizeChargeToBody,
  validateIndentChargeTo,
  inheritChargeTo
};
