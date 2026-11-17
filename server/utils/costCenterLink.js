const mongoose = require('mongoose');

/**
 * Store documents (SIN, SRN) use the procurement CostCenter; journal entries use FinanceCostCenter (one set per
 * company). This maps one to the other so stock journals carry the cost center the store picked:
 * remembered link for that company → same-name finance cost center → a new one with that name.
 */

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** @returns {Promise<ObjectId|null>} FinanceCostCenter id, or null when there is nothing to map */
const resolveFinanceCostCenter = async (procurementCostCenterId, companyId) => {
  if (!procurementCostCenterId || !companyId) return null;
  const CostCenter = mongoose.model('CostCenter');
  const FinanceCostCenter = require('../models/finance/CostCenter');

  const cc = await CostCenter.findById(procurementCostCenterId).select('name code financeLinks').lean();
  if (!cc?.name) return null;

  const link = (cc.financeLinks || []).find((l) => String(l.companyId) === String(companyId));
  if (link?.financeCostCenter && await FinanceCostCenter.exists({ _id: link.financeCostCenter })) {
    return link.financeCostCenter;
  }

  const code = String(cc.code || '').trim() || `CC-${cc._id}`;
  let finance = await FinanceCostCenter.findOne({
    companyId,
    $or: [{ code }, { name: { $regex: `^${escapeRegex(cc.name.trim())}$`, $options: 'i' } }]
  }).select('_id').lean();
  if (!finance) {
    finance = await FinanceCostCenter.create({
      companyId,
      name: cc.name.trim(),
      code,
      description: `Linked to store cost center ${cc.code || cc.name}`
    });
  }

  await CostCenter.updateOne({ _id: cc._id }, { $pull: { financeLinks: { companyId } } });
  await CostCenter.updateOne({ _id: cc._id }, { $push: { financeLinks: { companyId, financeCostCenter: finance._id } } });
  return finance._id;
};

/**
 * Keep Finance's per-company copies in step with one store cost center (the Store → Cost Center page is the only
 * place cost centers are managed). Applicable companies: its own company, or every active company when it has none.
 * Copies there get the store name / code / active flag; copies in companies it no longer applies to are deactivated.
 * Never throws — a failed copy must not stop the store change.
 */
const syncFinanceCopies = async (storeCostCenterId) => {
  try {
    const CostCenter = mongoose.model('CostCenter');
    const FinanceCostCenter = require('../models/finance/CostCenter');
    const PlacementCompany = mongoose.model('PlacementCompany');
    const cc = await CostCenter.findById(storeCostCenterId).select('name code company companies isActive financeLinks').lean();
    if (!cc) return;

    const ownCompanies = CostCenter.companyIdsOf(cc);
    const companyIds = ownCompanies.length
      ? ownCompanies
      : (await PlacementCompany.find({ isActive: { $ne: false } }).select('_id').lean()).map((c) => String(c._id));

    if (cc.isActive) {
      for (const companyId of companyIds) {
        const financeId = await resolveFinanceCostCenter(cc._id, companyId);
        if (!financeId) continue;
        const update = { name: cc.name.trim(), isActive: true };
        if (cc.code) update.code = cc.code;
        await FinanceCostCenter.updateOne({ _id: financeId }, { $set: update }).catch(async (err) => {
          // Code already used by another Finance cost center of that company: keep the old code, still sync the rest
          console.warn('[costCenterLink] code sync skipped:', err.message);
          await FinanceCostCenter.updateOne({ _id: financeId }, { $set: { name: update.name, isActive: true } });
        });
      }
    }

    const fresh = await CostCenter.findById(cc._id).select('financeLinks').lean();
    const toDeactivate = (fresh?.financeLinks || [])
      .filter((l) => !cc.isActive || !companyIds.includes(String(l.companyId)))
      .map((l) => l.financeCostCenter)
      .filter(Boolean);
    if (toDeactivate.length) {
      await FinanceCostCenter.updateMany({ _id: { $in: toDeactivate } }, { $set: { isActive: false } });
    }
  } catch (err) {
    console.warn('[costCenterLink] finance copy sync failed:', err.message);
  }
};

/** Deactivate every Finance copy of a store cost center (it is being deleted). Never throws. */
const deactivateFinanceCopies = async (storeCostCenter) => {
  try {
    const FinanceCostCenter = require('../models/finance/CostCenter');
    const ids = (storeCostCenter?.financeLinks || []).map((l) => l.financeCostCenter).filter(Boolean);
    if (ids.length) await FinanceCostCenter.updateMany({ _id: { $in: ids } }, { $set: { isActive: false } });
  } catch (err) {
    console.warn('[costCenterLink] finance copy deactivate failed:', err.message);
  }
};

/**
 * Make sure every active store cost center that applies to `companyId` has its Finance copy (used before Finance
 * lists its cost centers, so cost centers made before the sync existed show up too).
 */
const ensureFinanceCopiesForCompany = async (companyId) => {
  if (!companyId || !mongoose.Types.ObjectId.isValid(String(companyId))) return;
  try {
    const CostCenter = mongoose.model('CostCenter');
    // Its own companies include this one, or it has none (shared); older records may only have the single field
    const list = await CostCenter.find({
      isActive: true,
      $or: [
        { companies: companyId },
        { company: companyId },
        { $and: [{ $or: [{ companies: { $size: 0 } }, { companies: { $exists: false } }] }, { $or: [{ company: null }, { company: { $exists: false } }] }] }
      ]
    }).select('_id financeLinks').lean();
    const missing = list.filter((cc) => !(cc.financeLinks || []).some((l) => String(l.companyId) === String(companyId)));
    for (const cc of missing) {
      await resolveFinanceCostCenter(cc._id, companyId);
    }
  } catch (err) {
    console.warn('[costCenterLink] ensure finance copies failed:', err.message);
  }
};

module.exports = { resolveFinanceCostCenter, syncFinanceCopies, deactivateFinanceCopies, ensureFinanceCopiesForCompany };
