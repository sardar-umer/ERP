const mongoose = require('mongoose');

/**
 * Mandatory cost center rules (Finance, Nov 2026).
 *
 * - Every department maps to one default store cost center (CostCenter.isDepartmentDefault). Documents raised by
 *   that department pre-fill with it. When a department has no flagged default but exactly one active cost center,
 *   that one is used.
 * - SystemSettings.costCenterMandatoryFrom is the go-live date. Documents whose chain started before it are exempt;
 *   from it onwards a cost center is required. Null = not live, nothing is blocked.
 */

const getModels = () => ({
  CostCenter: mongoose.model('CostCenter'),
  Department: require('../models/hr/Department'),
  SystemSettings: require('../models/general/SystemSettings')
});

const getCostCenterMandatoryFrom = async () => {
  const { SystemSettings } = getModels();
  const settings = await SystemSettings.findOne({ key: 'default' })
    .select('costCenterMandatoryFrom costCenterMandatoryUpdatedAt costCenterMandatoryUpdatedBy')
    .populate('costCenterMandatoryUpdatedBy', 'firstName lastName')
    .lean();
  return {
    mandatoryFrom: settings?.costCenterMandatoryFrom || null,
    updatedAt: settings?.costCenterMandatoryUpdatedAt || null,
    updatedBy: settings?.costCenterMandatoryUpdatedBy || null
  };
};

/** Start of the given day in local server time, so a date picked in the UI covers that whole day */
const startOfDay = (value) => {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  d.setHours(0, 0, 0, 0);
  return d;
};

const setCostCenterMandatoryFrom = async (value, userId) => {
  const { SystemSettings } = getModels();
  const date = value ? startOfDay(value) : null;
  if (value && !date) {
    const err = new Error('Invalid go-live date');
    err.statusCode = 400;
    throw err;
  }
  const settings = await SystemSettings.getSingleton();
  settings.costCenterMandatoryFrom = date;
  settings.costCenterMandatoryUpdatedBy = userId || null;
  settings.costCenterMandatoryUpdatedAt = new Date();
  await settings.save();
  return date;
};

/**
 * Is a cost center required for a document whose chain started on `chainStartDate`
 * (the indent / PO / cash approval / bill that began it)?
 */
const isCostCenterMandatory = async (chainStartDate = new Date()) => {
  const { mandatoryFrom } = await getCostCenterMandatoryFrom();
  if (!mandatoryFrom) return false;
  const started = new Date(chainStartDate || Date.now());
  return started >= new Date(mandatoryFrom);
};

/** @returns {Promise<object|null>} the department's default active cost center (lean) */
const getDepartmentDefaultCostCenter = async (departmentId) => {
  if (!departmentId || !mongoose.Types.ObjectId.isValid(String(departmentId))) return null;
  const { CostCenter } = getModels();
  const fields = 'code name path department isDepartmentDefault isActive company companies';
  const flagged = await CostCenter.findOne({ department: departmentId, isDepartmentDefault: true, isActive: true })
    .select(fields).lean();
  if (flagged) return flagged;
  const active = await CostCenter.find({ department: departmentId, isActive: true }).select(fields).limit(2).lean();
  return active.length === 1 ? active[0] : null;
};

/**
 * Throws 400 when another active cost center is already this department's default.
 * Call before saving a cost center that is (or stays) flagged as default.
 */
const assertDepartmentDefaultFree = async (departmentId, excludeId = null) => {
  const { CostCenter } = getModels();
  const query = { department: departmentId, isDepartmentDefault: true, isActive: true };
  if (excludeId) query._id = { $ne: excludeId };
  const existing = await CostCenter.findOne(query).select('code name').lean();
  if (existing) {
    const err = new Error(
      `This department already has a default cost center: ${existing.code} — ${existing.name}. ` +
      'Each department can have only one; change that one first, or use "Set as default" on the department check.'
    );
    err.statusCode = 400;
    throw err;
  }
};

/** Make `costCenterId` its department's only default (clears the flag on the others) */
const makeDepartmentDefault = async (costCenterId, userId) => {
  const { CostCenter } = getModels();
  const cc = await CostCenter.findById(costCenterId);
  if (!cc) {
    const err = new Error('Cost center not found');
    err.statusCode = 404;
    throw err;
  }
  if (!cc.department) {
    const err = new Error('Set a department on this cost center before making it the department default');
    err.statusCode = 400;
    throw err;
  }
  if (!cc.isActive) {
    const err = new Error('An inactive cost center cannot be a department default');
    err.statusCode = 400;
    throw err;
  }
  await CostCenter.updateMany(
    { department: cc.department, _id: { $ne: cc._id }, isDepartmentDefault: true },
    { $set: { isDepartmentDefault: false, updatedBy: userId } }
  );
  cc.isDepartmentDefault = true;
  cc.updatedBy = userId;
  await cc.save();
  return cc;
};

/**
 * One row per active department: its default cost center (if any) and how it was found.
 * status: 'default' (flagged) | 'single' (only one active, used automatically) | 'choose' (several, none flagged) | 'missing'
 */
const getDepartmentCoverage = async () => {
  const { CostCenter, Department } = getModels();
  const [departments, costCenters] = await Promise.all([
    Department.find({ isActive: true }).select('name code').sort({ name: 1 }).lean(),
    CostCenter.find({ department: { $ne: null }, isActive: true })
      .select('code name path department isDepartmentDefault').sort({ level: 1, code: 1 }).lean()
  ]);

  const byDept = new Map();
  costCenters.forEach((cc) => {
    const key = String(cc.department);
    if (!byDept.has(key)) byDept.set(key, []);
    byDept.get(key).push(cc);
  });

  const rows = departments.map((dept) => {
    const list = byDept.get(String(dept._id)) || [];
    const flagged = list.filter((cc) => cc.isDepartmentDefault);
    let status = 'missing';
    let defaultCostCenter = null;
    if (flagged.length) {
      status = 'default';
      [defaultCostCenter] = flagged;
    } else if (list.length === 1) {
      status = 'single';
      [defaultCostCenter] = list;
    } else if (list.length > 1) {
      status = 'choose';
    }
    return {
      department: dept,
      status,
      defaultCostCenter,
      costCenters: list.map(({ _id, code, name, path, isDepartmentDefault }) => ({ _id, code, name, path, isDepartmentDefault }))
    };
  });

  const summary = rows.reduce((acc, r) => {
    acc[r.status] = (acc[r.status] || 0) + 1;
    return acc;
  }, { default: 0, single: 0, choose: 0, missing: 0 });
  summary.total = rows.length;
  summary.ready = summary.default + summary.single;

  return { rows, summary };
};

/** Active cost centers for form dropdowns (readable by every signed-in user) */
const listCostCenterOptions = async () => {
  const { CostCenter } = getModels();
  return CostCenter.find({ isActive: true })
    .select('code name path level parent department isDepartmentDefault company companies project')
    .populate('department', 'name')
    .populate('company', 'name')
    .populate('companies', 'name')
    .sort({ path: 1, code: 1 })
    .lean();
};

/**
 * Why a cost center cannot be used on a document of `companyId` (null when it can):
 * missing, inactive, or assigned to a different company. Cost centers with no company suit every company.
 */
const costCenterProblem = async (costCenterId, companyId = null) => {
  const { CostCenter } = getModels();
  const cc = mongoose.Types.ObjectId.isValid(String(costCenterId))
    ? await CostCenter.findById(costCenterId).select('isActive code name company companies')
      .populate('company', 'name').populate('companies', 'name').lean()
    : null;
  if (!cc) return 'the selected cost center no longer exists';
  if (!cc.isActive) return `cost center ${cc.code} — ${cc.name} is inactive; pick another one`;
  const allowed = CostCenter.companyIdsOf(cc);
  if (companyId && allowed.length && !allowed.includes(String(companyId?._id || companyId))) {
    const names = (cc.companies?.length ? cc.companies : [cc.company]).map((c) => c?.name).filter(Boolean);
    return `cost center ${cc.code} — ${cc.name} is only for ${names.join(', ') || 'other companies'}; pick one of this document's company`;
  }
  return null;
};

const badRequest = (message) => {
  const err = new Error(message);
  err.statusCode = 400;
  return err;
};

/**
 * Call from a document's pre-save. `label` names the document in the message ("Indent", "Purchase order").
 * - A newly picked cost center must exist and be active.
 * - When the document's chain started on/after go-live, a cost center is required.
 * Only runs when the document is new or its cost center changed, so old documents saving for other reasons are untouched.
 */
const checkDocumentCostCenter = async (doc, { chainStartDate, label = 'This document', checkCompany = true } = {}) => {
  const companyChanged = doc.isModified('companyId');
  if (!doc.isNew && !doc.isModified('costCenter') && !companyChanged) return;
  if (doc.costCenter) {
    if (!doc.isNew && !doc.isModified('costCenter') && !checkCompany) return;
    const error = await costCenterProblem(doc.costCenter, checkCompany ? doc.companyId : null);
    if (error) throw badRequest(`${label}: ${error}`);
    return;
  }
  if (!doc.isNew && !doc.isModified('costCenter')) return;
  const started = chainStartDate || (doc.isNew ? new Date() : doc.createdAt);
  if (await isCostCenterMandatory(started)) {
    throw badRequest(`${label}: cost center is required`);
  }
};

/**
 * Where a PO's chain started (its indent's creation, else the PO's own) and its cost center.
 * @returns {Promise<{costCenter: ObjectId|null, chainStartDate: Date|null}>}
 */
const resolvePurchaseOrderChain = async (poId) => {
  if (!poId) return { costCenter: null, chainStartDate: null };
  const po = await mongoose.model('PurchaseOrder').findById(poId).select('costCenter indent createdAt').lean();
  if (!po) return { costCenter: null, chainStartDate: null };
  let chainStartDate = po.createdAt || null;
  if (po.indent) {
    const indent = await mongoose.model('Indent').findById(po.indent).select('createdAt').lean();
    if (indent?.createdAt) chainStartDate = indent.createdAt;
  }
  return { costCenter: po.costCenter || null, chainStartDate };
};

const BILL_SOURCE_MODELS = {
  utility_bill: 'UtilityBill',
  project_ipc: 'ProjectInvoice',
  final_settlement: 'FinalSettlement'
};

/** Same for a bill: GRN / PO bills follow their PO chain; bills from other modules follow their source document */
const resolveBillChain = async (bill) => {
  const grnIds = [
    ...(bill.linkedGRNs || []).map((g) => g.grnId),
    bill.referenceType === 'grn' ? bill.referenceId : null
  ].filter(Boolean);
  let poId = (bill.linkedGRNs || []).map((g) => g.poId).find(Boolean)
    || (bill.referenceType === 'purchase_order' ? bill.referenceId : null);
  let grnCostCenter = null;
  if (grnIds.length) {
    const grn = await mongoose.model('GoodsReceive').findById(grnIds[0]).select('costCenter purchaseOrder').lean();
    if (grn) {
      grnCostCenter = grn.costCenter || null;
      poId = poId || grn.purchaseOrder;
    }
  }
  if (poId) {
    const chain = await resolvePurchaseOrderChain(poId);
    return { costCenter: grnCostCenter || chain.costCenter, chainStartDate: chain.chainStartDate || bill.createdAt || null };
  }
  // Bills raised from another module (utility / centralized store bill, IPC, final settlement) start when that
  // document was created — an old one posted to Finance after go-live stays exempt
  const sourceModel = BILL_SOURCE_MODELS[bill.referenceType];
  if (sourceModel && bill.referenceId && mongoose.modelNames().includes(sourceModel)) {
    const source = await mongoose.model(sourceModel).findById(bill.referenceId).select('createdAt').lean();
    if (source?.createdAt) return { costCenter: grnCostCenter, chainStartDate: source.createdAt };
  }
  return { costCenter: grnCostCenter, chainStartDate: bill.createdAt || null };
};

/**
 * Finance block: a bill whose chain started on/after go-live cannot be paid / settled without a cost center.
 * Throws 400 naming the bills that are missing one.
 */
const assertBillsHaveCostCenter = async (bills, action = 'paid') => {
  const missing = [];
  for (const bill of (bills || []).filter(Boolean)) {
    if (bill.costCenter) continue;
    const { chainStartDate } = await resolveBillChain(bill);
    if (await isCostCenterMandatory(chainStartDate || bill.createdAt || new Date())) {
      missing.push(bill.billNumber || String(bill._id));
    }
  }
  if (missing.length) {
    throw badRequest(
      `Cost center is required before a bill can be ${action}: ${missing.join(', ')}. ` +
      'Set it on the bill (Change cost center) and try again.'
    );
  }
};

/**
 * Store cost center of the document a journal entry came from (bill, cash approval, vendor advance, GRN, PO,
 * bill payment). Looked up by id across those collections — ObjectIds are unique, so at most one matches.
 */
const findSourceStoreCostCenter = async (referenceId) => {
  if (!referenceId || !mongoose.Types.ObjectId.isValid(String(referenceId))) return null;
  const tryModel = async (name, select) => {
    if (!mongoose.modelNames().includes(name)) return null;
    return mongoose.model(name).findById(referenceId).select(select).lean();
  };
  const bill = await tryModel('AccountsPayable', 'costCenter');
  if (bill) return bill.costCenter || null;
  const ca = await tryModel('CashApproval', 'costCenter');
  if (ca) return ca.costCenter || null;
  const adv = await tryModel('VendorAdvance', 'storeCostCenter');
  if (adv) return adv.storeCostCenter || null;
  const grn = await tryModel('GoodsReceive', 'costCenter');
  if (grn) return grn.costCenter || null;
  const po = await tryModel('PurchaseOrder', 'costCenter');
  if (po) return po.costCenter || null;
  const app = await tryModel('ApPaymentApplication', 'accountsPayableId bills.billId');
  if (app) {
    const billIds = (app.bills?.length ? app.bills.map((b) => b.billId) : [app.accountsPayableId]).filter(Boolean);
    const bills = await mongoose.model('AccountsPayable').find({ _id: { $in: billIds } }).select('costCenter').lean();
    const ids = [...new Set(bills.map((b) => String(b.costCenter || '')).filter(Boolean))];
    return ids.length === 1 ? ids[0] : null; // several bills on different cost centers: leave untagged
  }
  return null;
};

module.exports = {
  costCenterProblem,
  findSourceStoreCostCenter,
  resolvePurchaseOrderChain,
  resolveBillChain,
  assertBillsHaveCostCenter,
  listCostCenterOptions,
  checkDocumentCostCenter,
  getCostCenterMandatoryFrom,
  setCostCenterMandatoryFrom,
  isCostCenterMandatory,
  getDepartmentDefaultCostCenter,
  assertDepartmentDefaultFree,
  makeDepartmentDefault,
  getDepartmentCoverage
};
