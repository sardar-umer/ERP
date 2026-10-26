const mongoose = require('mongoose');
const JournalEntry = require('../models/finance/JournalEntry');
const VendorAdvance = require('../models/finance/VendorAdvance');

const isFullAdvancePaymentTerm = (paymentTerms) => {
  const terms = String(paymentTerms || '').toLowerCase().trim();
  if (!terms) return false;
  return terms.includes('full advance') || (terms.includes('advance') && !terms.includes('partial'));
};

const jeSignedDocumentComplete = (je) =>
  je && je.signedDocumentStatus === 'signed' && Boolean(je.signedDocumentAt);

/** Build map journalEntryId -> signed (for PO advance totals / auto-approve). */
async function buildJournalEntrySignedMapForVendorAdvances(advanceRows) {
  const ids = [
    ...new Set(
      (advanceRows || [])
        .filter((a) => a.voucherWorkflowStatus === 'fully_approved' && a.journalEntryId)
        .map((a) => String(a.journalEntryId))
    )
  ];
  if (!ids.length) return {};
  const jes = await JournalEntry.find({ _id: { $in: ids } })
    .select('signedDocumentStatus signedDocumentAt')
    .lean();
  const m = {};
  jes.forEach((je) => {
    m[String(je._id)] = jeSignedDocumentComplete(je);
  });
  return m;
}

/** Vendor advance counts toward PO “recorded” / auto-approve only when voucher is signed (fully_approved + signed doc). Legacy immediate = posted without that gate. */
const vendorAdvanceAmountCountsForPo = (a, jeSignedByJournalId = {}) => {
  const s = a?.voucherWorkflowStatus;
  if (s === 'pending_authority' || s === 'rejected') return false;
  if (s === 'fully_approved') {
    const jid = a.journalEntryId ? String(a.journalEntryId) : '';
    return Boolean(jid && jeSignedByJournalId[jid]);
  }
  return true;
};

/**
 * Procurement / store path: count advance once finance authorities posted the voucher.
 * Signed PDF is tracked separately (see vendorAdvanceAmountCountsForPo for finance auto-approve).
 */
const vendorAdvanceAmountCountsForProcurement = (a, jePostedByJournalId = {}) => {
  const s = a?.voucherWorkflowStatus;
  if (s === 'pending_authority' || s === 'rejected') return false;
  if (s === 'fully_approved') {
    const jid = a.journalEntryId ? String(a.journalEntryId) : '';
    return Boolean(jid && jePostedByJournalId[jid]);
  }
  return true;
};

function referenceIdMatchForPo(poId) {
  const idStr = String(poId);
  if (mongoose.Types.ObjectId.isValid(idStr)) {
    const oid = new mongoose.Types.ObjectId(idStr);
    return { $in: [oid, idStr] };
  }
  return idStr;
}

/**
 * Vendor advances tied to a PO. Schema default referenceType is "advance"; Finance may still set referenceId to the PO.
 * Treat purchase_order, advance, empty, or missing referenceType as PO-linked when referenceId matches.
 */
function vendorAdvancesLinkedToPurchaseOrderFilter(poId) {
  return {
    referenceId: referenceIdMatchForPo(poId),
    $or: [
      { referenceType: 'purchase_order' },
      { referenceType: 'advance' },
      { referenceType: null },
      { referenceType: '' },
      { referenceType: { $exists: false } }
    ]
  };
}

async function fetchVendorAdvancesLinkedToPurchaseOrder(poId) {
  return VendorAdvance.find(vendorAdvancesLinkedToPurchaseOrderFilter(poId))
    .select('amount voucherWorkflowStatus journalEntryId referenceType')
    .lean();
}

/** Load JE flags for all advances on this PO (one DB round-trip). */
async function buildJournalEntrySignedAndPostedMapsForAdvanceRows(rows) {
  const ids = [
    ...new Set((rows || []).filter((a) => a.journalEntryId).map((a) => String(a.journalEntryId)))
  ];
  if (!ids.length) {
    return { signedByJournalId: {}, postedByJournalId: {} };
  }
  const jes = await JournalEntry.find({ _id: { $in: ids } })
    .select('status signedDocumentStatus signedDocumentAt')
    .lean();
  const signedByJournalId = {};
  const postedByJournalId = {};
  jes.forEach((je) => {
    const id = String(je._id);
    signedByJournalId[id] = jeSignedDocumentComplete(je);
    postedByJournalId[id] = String(je.status || '').toLowerCase() === 'posted';
  });
  return { signedByJournalId, postedByJournalId };
}

/**
 * Sum vendor advances linked to a PO.
 * @param {'strict'|'procurement'} sumKind strict = signed voucher (finance auto-approve); procurement = posted JE after full approval
 */
async function sumPostedVendorAdvancesForPo(poId, sumKind = 'strict') {
  const rows = await fetchVendorAdvancesLinkedToPurchaseOrder(poId);
  if (!rows.length) return 0;
  const { signedByJournalId, postedByJournalId } = await buildJournalEntrySignedAndPostedMapsForAdvanceRows(rows);
  let sum = 0;
  for (const a of rows) {
    const ok =
      sumKind === 'procurement'
        ? vendorAdvanceAmountCountsForProcurement(a, postedByJournalId)
        : vendorAdvanceAmountCountsForPo(a, signedByJournalId);
    if (!ok) continue;
    sum += Math.round((Number(a.amount) || 0) * 100) / 100;
  }
  return sum;
}

/**
 * Everything already committed against a PO: every linked advance except rejected ones, whatever stage
 * its voucher is in. Use this to cap new payments so a PO can be paid in parts but never overpaid.
 */
const vendorAdvanceCommittedToPo = (a) => a?.voucherWorkflowStatus !== 'rejected';

async function sumCommittedVendorAdvancesForPo(poId) {
  const rows = await fetchVendorAdvancesLinkedToPurchaseOrder(poId);
  return rows
    .filter(vendorAdvanceCommittedToPo)
    .reduce((sum, a) => sum + Math.round((Number(a.amount) || 0) * 100) / 100, 0);
}

/** True when PO uses full-advance terms and counted vendor advances cover PO total (finance: signed voucher). */
async function isFullAdvancePaidForPo(poDoc) {
  if (!poDoc?._id || !isFullAdvancePaymentTerm(poDoc.paymentTerms)) return false;
  const poTotal = Math.round((Number(poDoc.totalAmount) || 0) * 100) / 100;
  if (poTotal <= 0) return false;
  const paid = await sumPostedVendorAdvancesForPo(poDoc._id, 'strict');
  return paid + 0.009 >= poTotal;
}

/**
 * Store / procurement: full-advance POs use the delivery-challan → QA → GRN path.
 * Intentionally does not depend on finance advance totals (those stay informational in getGrnDcEligibility).
 */
function requiresDeliveryChallanFlow(poDoc) {
  if (!poDoc?._id) return false;
  const poTotal = Math.round((Number(poDoc.totalAmount) || 0) * 100) / 100;
  return isFullAdvancePaymentTerm(poDoc.paymentTerms) && poTotal > 0;
}

/**
 * Explains delivery-challan / GRN context for full-advance POs. Advance totals are informational only.
 */
async function getGrnDcEligibility(poDoc) {
  const rawTerms = poDoc?.paymentTerms;
  const termsRecognized = isFullAdvancePaymentTerm(rawTerms);
  const poTotal = Math.round((Number(poDoc?.totalAmount) || 0) * 100) / 100;
  let countedAdvanceTotal = 0;
  let countedAdvanceFinanceStrict = 0;
  let linkedRows = [];
  if (poDoc?._id) {
    try {
      linkedRows = await fetchVendorAdvancesLinkedToPurchaseOrder(poDoc._id);
      const { signedByJournalId, postedByJournalId } = await buildJournalEntrySignedAndPostedMapsForAdvanceRows(linkedRows);
      for (const a of linkedRows) {
        const amt = Math.round((Number(a.amount) || 0) * 100) / 100;
        if (vendorAdvanceAmountCountsForProcurement(a, postedByJournalId)) countedAdvanceTotal += amt;
        if (vendorAdvanceAmountCountsForPo(a, signedByJournalId)) countedAdvanceFinanceStrict += amt;
      }
    } catch (_) {
      countedAdvanceTotal = 0;
      countedAdvanceFinanceStrict = 0;
      linkedRows = [];
    }
  }
  const advanceMeetsPoTotal = poTotal > 0 && countedAdvanceTotal + 0.009 >= poTotal;
  const grnRequiresDeliveryChallan = requiresDeliveryChallanFlow(poDoc);
  const gap = Math.round((poTotal - countedAdvanceTotal) * 100) / 100;
  const pendingAuthorityCount = linkedRows.filter((r) => r.voucherWorkflowStatus === 'pending_authority').length;
  let note = '';
  if (!termsRecognized) {
    note =
      'Payment terms are not treated as full advance (need wording like "Full advance" or "advance" without "partial").';
  } else if (poTotal <= 0) {
    note = 'PO total is zero.';
  } else if (!advanceMeetsPoTotal) {
    if (linkedRows.length === 0) {
      note =
        'No vendor advance linked to this PO in Finance yet (optional for creating a DC — link the PO when you record the advance for audit).';
    } else if (pendingAuthorityCount > 0) {
      note = `${pendingAuthorityCount} linked advance(s) still in finance voucher approval. You can still create a DC if the PO status allows.`;
    } else {
      note =
        'Linked advances (posted to procurement total) are below the PO total — Finance can review; store can still create a DC when the PO status allows.';
    }
  } else if (countedAdvanceFinanceStrict + 0.009 < poTotal && countedAdvanceTotal + 0.009 >= poTotal) {
    note =
      'Journal posted for the advance; signed voucher in Finance may still be pending.';
  }
  return {
    paymentTerms: rawTerms == null ? '' : String(rawTerms),
    paymentTermsRecognizedAsFullAdvance: termsRecognized,
    countedAdvanceTotal,
    countedAdvanceFinanceStrict,
    poTotal,
    advanceMeetsPoTotal,
    remainingAdvanceToRecord: Math.max(0, gap),
    grnRequiresDeliveryChallan,
    linkedAdvancesOnThisPo: linkedRows.length,
    linkedAdvancesPendingAuthority: pendingAuthorityCount,
    note
  };
}

module.exports = {
  isFullAdvancePaymentTerm,
  buildJournalEntrySignedMapForVendorAdvances,
  vendorAdvanceAmountCountsForPo,
  vendorAdvanceAmountCountsForProcurement,
  vendorAdvanceCommittedToPo,
  sumCommittedVendorAdvancesForPo,
  vendorAdvancesLinkedToPurchaseOrderFilter,
  sumPostedVendorAdvancesForPo,
  isFullAdvancePaidForPo,
  requiresDeliveryChallanFlow,
  getGrnDcEligibility
};
