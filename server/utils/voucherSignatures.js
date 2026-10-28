/**
 * "Signed by" summary for the Voucher Center list: whether Sr Manager Accounts and GM Finance have signed each voucher.
 * Same sources as the voucher view (payment application, payroll / manual salary payment, vendor advance,
 * cash approval, or the manual JV itself), loaded in one query per source for the whole page.
 */
const mongoose = require('mongoose');

// The Accounts Officer is always present on a voucher, so the column tracks only the two approval authorities
const SLOTS = [
  { key: 'accountsManagerUser', label: 'Sr Manager Accounts' },
  { key: 'financeControllerUser', label: 'GM Finance' }
];
const USER_FIELDS = 'firstName lastName email';
const AUTHORITY_POPULATE = [
  { path: 'financeAuthorityApprovals.approver', select: USER_FIELDS },
  ...SLOTS.map((s) => ({ path: `financeApprovalAuthorities.${s.key}`, select: USER_FIELDS, strictPopulate: false }))
];

const userName = (u) => {
  if (!u || typeof u !== 'object') return '';
  return [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.email || '';
};

/** Assigned or decided authorities, in signing order */
const summarize = (doc) => {
  if (!doc) return null;
  const assigned = doc.financeApprovalAuthorities || {};
  const approvals = Array.isArray(doc.financeAuthorityApprovals) ? doc.financeAuthorityApprovals : [];
  const byKey = new Map(approvals.filter((a) => a?.authorityKey).map((a) => [String(a.authorityKey).trim(), a]));
  const slots = SLOTS
    .filter((s) => assigned[s.key] || byKey.has(s.key))
    .map((s) => {
      const approval = byKey.get(s.key);
      return {
        key: s.key,
        label: approval?.authorityLabel || s.label,
        name: userName(approval?.approver) || userName(assigned[s.key]) || '',
        status: approval ? (approval.decision === 'rejected' ? 'rejected' : 'approved') : 'pending',
        at: approval?.approvedAt || null
      };
    });
  if (!slots.length) return null;
  return {
    slots,
    signed: slots.filter((s) => s.status === 'approved').length,
    rejected: slots.some((s) => s.status === 'rejected'),
    total: slots.length
  };
};

const optionalModel = (name, file) => {
  try {
    return mongoose.models[name] || require(file);
  } catch (_) {
    return null;
  }
};

/** Adds `signatures` ({ slots, signed, total, rejected } or null) to each plain voucher object */
const attachVoucherSignatures = async (entries) => {
  if (!Array.isArray(entries) || !entries.length) return entries;
  const ids = entries.map((e) => e._id).filter(Boolean);
  const caIds = entries
    .filter((e) => e.referenceModel === 'CashApproval' && e.referenceId)
    .map((e) => e.referenceId?._id || e.referenceId);

  const sources = [
    [optionalModel('ApPaymentApplication', '../models/finance/ApPaymentApplication'), { $or: [{ journalEntryId: { $in: ids } }, { payingJournalEntryId: { $in: ids } }] }],
    [optionalModel('PayrollPeriodPaymentApplication', '../models/finance/PayrollPeriodPaymentApplication'), { journalEntryId: { $in: ids } }],
    [optionalModel('ManualSalaryPaymentApplication', '../models/finance/ManualSalaryPaymentApplication'), { journalEntryId: { $in: ids } }],
    [optionalModel('VendorAdvance', '../models/finance/VendorAdvance'), { $or: [{ journalEntryId: { $in: ids } }, { payingJournalEntryId: { $in: ids } }] }],
    [optionalModel('CashApproval', '../models/procurement/CashApproval'), { $or: [{ voucherEntryId: { $in: ids } }, { _id: { $in: caIds } }] }]
  ];

  // Voucher id -> first matching source document (same precedence as the voucher view)
  const docByVoucher = new Map();
  const results = await Promise.all(sources.map(([Model, query]) => (Model
    ? Model.find(query)
      .select('journalEntryId payingJournalEntryId voucherEntryId financeApprovalAuthorities financeAuthorityApprovals')
      .populate(AUTHORITY_POPULATE)
      .lean()
      .catch(() => [])
    : [])));
  results.forEach((docs, sourceIndex) => {
    docs.forEach((doc) => {
      const voucherIds = [doc.journalEntryId, doc.payingJournalEntryId, doc.voucherEntryId].filter(Boolean).map(String);
      if (sourceIndex === 4) {
        entries
          .filter((e) => e.referenceModel === 'CashApproval' && String(e.referenceId?._id || e.referenceId) === String(doc._id))
          .forEach((e) => voucherIds.push(String(e._id)));
      }
      voucherIds.forEach((vid) => { if (!docByVoucher.has(vid)) docByVoucher.set(vid, doc); });
    });
  });

  // Manual JVs carry their own authorities
  const manualIds = entries.filter((e) => !docByVoucher.has(String(e._id))).map((e) => e._id);
  if (manualIds.length) {
    const own = await mongoose.model('JournalEntry').find({ _id: { $in: manualIds } })
      .select('financeApprovalAuthorities financeAuthorityApprovals')
      .populate(AUTHORITY_POPULATE)
      .lean()
      .catch(() => []);
    own.forEach((doc) => docByVoucher.set(String(doc._id), doc));
  }

  entries.forEach((e) => { e.signatures = summarize(docByVoucher.get(String(e._id))); });
  return entries;
};

module.exports = { attachVoucherSignatures };
