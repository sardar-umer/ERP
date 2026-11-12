/**
 * Possible duplicate bills (Centralized Store / utility bills) — a warning, not a block.
 *
 * A bill is flagged when an existing, still-live bill has:
 *   - the same company it is booked to, the same vendor (or payee employee) and the same amount,
 *     with a bill date within DUPLICATE_WINDOW_DAYS; or
 *   - the same meter / account number for the same billing month (almost always a true duplicate).
 */
const mongoose = require('mongoose');
const { resolveUtilityBillCompanyId, getUtilityBillPostAmount } = require('./utilityBillFinance');

const DUPLICATE_WINDOW_DAYS = 45;
const DAY_MS = 24 * 60 * 60 * 1000;

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const idOf = (v) => (v && typeof v === 'object' && v._id ? String(v._id) : v ? String(v) : '');
const normText = (v) => String(v || '').trim().toLowerCase().replace(/\s+/g, ' ');

/** Amount the bill is booked at: its lines when it has them, else the header amount */
const billAmount = (bill) => {
  const fromLines = getUtilityBillPostAmount(bill);
  return round2(fromLines > 0 ? fromLines : bill.amount);
};

/** Meter / account numbers on the bill (header account number + line meter numbers) */
const meterKeys = (bill) => [
  bill.accountNumber,
  ...(Array.isArray(bill.billLines) ? bill.billLines.map((l) => l?.meterNumber) : [])
].map(normText).filter((v) => v && v.length >= 3);

const monthKey = (d) => {
  const date = d ? new Date(d) : null;
  return date && !Number.isNaN(date.getTime()) ? `${date.getFullYear()}-${date.getMonth() + 1}` : '';
};

/**
 * @param {object} bill  the bill being created / edited (plain payload or document; billLines already parsed)
 * @param {{ excludeId?: string }} opts
 * @returns {Promise<Array>} matching bills, newest first
 */
const findPossibleDuplicateBills = async (bill, { excludeId = null } = {}) => {
  const UtilityBill = mongoose.model('UtilityBill');
  const amount = billAmount(bill);
  const vendorId = idOf(bill.vendorId);
  const payeeId = idOf(bill.payeeEmployee);
  const provider = normText(bill.provider);
  const meters = meterKeys(bill);
  if (!(amount > 0) && !meters.length) return [];

  const refDate = bill.billDate ? new Date(bill.billDate) : new Date();
  const from = new Date(refDate.getTime() - DUPLICATE_WINDOW_DAYS * DAY_MS);
  const to = new Date(refDate.getTime() + DUPLICATE_WINDOW_DAYS * DAY_MS);

  const vendorOr = [];
  if (vendorId && mongoose.Types.ObjectId.isValid(vendorId)) vendorOr.push({ vendorId: new mongoose.Types.ObjectId(vendorId) });
  if (payeeId && mongoose.Types.ObjectId.isValid(payeeId)) vendorOr.push({ payeeEmployee: new mongoose.Types.ObjectId(payeeId) });
  if (provider) vendorOr.push({ provider: { $regex: `^${provider.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' } });
  const meterOr = meters.length
    ? [{ accountNumber: { $in: meters.map((m) => new RegExp(`^${m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i')) } },
      { 'billLines.meterNumber': { $in: meters.map((m) => new RegExp(`^${m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i')) } }]
    : [];
  if (!vendorOr.length && !meterOr.length) return [];

  const query = {
    $or: [...vendorOr, ...meterOr],
    // still live: not rejected, not folded into a consolidated bill
    approvalStatus: { $ne: 'Rejected' },
    auditStatus: { $nin: ['Rejected (from Send to Audit)'] },
    consolidatedIntoBillId: null,
    $and: [{ $or: [{ billDate: { $gte: from, $lte: to } }, { billDate: null, createdAt: { $gte: from, $lte: to } }] }]
  };
  if (excludeId && mongoose.Types.ObjectId.isValid(String(excludeId))) query._id = { $ne: new mongoose.Types.ObjectId(String(excludeId)) };

  const candidates = await UtilityBill.find(query)
    .select('billId provider vendorId payeeEmployee amount billLines billDate createdAt createdBy site accountNumber approvalStatus auditStatus status useCentralizedStore')
    .populate('createdBy', 'firstName lastName')
    .sort({ billDate: -1, createdAt: -1 })
    .limit(50)
    .lean();
  if (!candidates.length) return [];

  const companyId = idOf(await resolveUtilityBillCompanyId(bill));
  const thisMonth = monthKey(bill.billDate || new Date());
  const out = [];
  for (const c of candidates) {
    const reasons = [];
    const sameVendor = (vendorId && idOf(c.vendorId) === vendorId)
      || (payeeId && idOf(c.payeeEmployee) === payeeId)
      || (!vendorId && !payeeId && provider && normText(c.provider) === provider);
    if (sameVendor && amount > 0 && Math.abs(billAmount(c) - amount) < 0.5) {
      const cCompany = idOf(await resolveUtilityBillCompanyId(c));
      if (cCompany && cCompany === companyId) reasons.push('Same company, vendor and amount');
    }
    const cMeters = meterKeys(c);
    if (meters.length && cMeters.some((m) => meters.includes(m)) && monthKey(c.billDate || c.createdAt) === thisMonth) {
      reasons.push('Same meter / account number in the same month');
    }
    if (!reasons.length) continue;
    out.push({
      _id: c._id,
      billId: c.billId,
      provider: c.provider,
      amount: billAmount(c),
      billDate: c.billDate || c.createdAt,
      approvalStatus: c.approvalStatus,
      auditStatus: c.auditStatus,
      useCentralizedStore: Boolean(c.useCentralizedStore),
      createdBy: c.createdBy ? `${c.createdBy.firstName || ''} ${c.createdBy.lastName || ''}`.trim() : '',
      reasons
    });
  }
  return out;
};

/** Values sent by the form when the user chose "Create anyway" */
const readDuplicateConfirmation = (body = {}) => {
  const confirmed = body.confirmDuplicate === true || body.confirmDuplicate === 'true';
  const reason = String(body.duplicateReason || '').trim();
  return { confirmed, reason };
};

module.exports = { findPossibleDuplicateBills, readDuplicateConfirmation, DUPLICATE_WINDOW_DAYS };
