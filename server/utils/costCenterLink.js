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

module.exports = { resolveFinanceCostCenter };
