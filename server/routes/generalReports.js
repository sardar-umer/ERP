const express = require('express');
const mongoose = require('mongoose');
const { authorize } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');

const router = express.Router();

const DAY_MS = 24 * 60 * 60 * 1000;

const RETURNED_RE = /^returned/i;
const RETURN_OR_REJECT_RE = /return|reject/i;

/** Who a document is waiting on at each workflow status. */
const STAGE_OWNER = {
  Draft: 'Initiator',
  Submitted: 'Department Approver',
  'Under Review': 'Department Approver',
  'Pending Approval': 'Department Approver',
  'Pending Department Approval': 'Department Approver',
  'Pending Audit': 'Pre-Audit',
  'Sent to Audit': 'Pre-Audit',
  'Send to Audit': 'Pre-Audit',
  'Initial Audit Approval': 'Pre-Audit',
  'Initial Pre-Audit Approved': 'Pre-Audit',
  'Forwarded to Audit Director': 'Audit Director',
  'Send to CEO Office': 'CEO Secretariat',
  'Forwarded to CEO': 'CEO',
  'Pending Finance': 'Finance',
  'Sent to Finance': 'Finance',
  'Finance Authority Approved': 'Finance (issue advance)',
  'Advance Issued': 'Requester (submit evidence)',
  'Evidence Submitted': 'Finance (settlement)',
  'Payment Settled': 'Finance',
  'Awaiting Payment': 'Finance (payment)',
  'Bill Received': 'Finance',
  'Sent to Procurement': 'Procurement',
  Approved: 'Procurement',
  'In Procurement': 'Procurement',
  'GRN Created': 'Procurement',
  'Partially Fulfilled': 'Procurement / Store',
  'Pending Store Check': 'Store',
  'Sent to Store': 'Store',
  Ordered: 'Vendor / Store',
  'Partially Received': 'Vendor / Store'
};

const ownerOf = (stage) => {
  if (RETURNED_RE.test(stage)) return 'Initiator (correction)';
  return STAGE_OWNER[stage] || 'Unassigned';
};

/**
 * Document types that carry a workflow. `stage(doc)` returns the stage the document is
 * waiting in, or null when the document is finished (or was never submitted).
 */
const DOC_TYPES = [
  {
    key: 'indent',
    label: 'Indent',
    model: 'Indent',
    select: 'indentNumber title status storeRoutingStatus approvalChain workflowHistory createdAt totalEstimatedCost',
    number: (d) => d.indentNumber,
    title: (d) => d.title,
    amount: (d) => d.totalEstimatedCost,
    link: (d) => `/general/indents/${d._id}`,
    stage: (d) => {
      if (['Fulfilled', 'Rejected', 'Rejected in Procurement', 'Cancelled'].includes(d.status)) return null;
      if (d.status === 'Approved') {
        if (d.storeRoutingStatus === 'moved_to_procurement') return 'In Procurement';
        return 'Pending Store Check';
      }
      return d.status;
    }
  },
  {
    key: 'purchase_order',
    label: 'Purchase Order',
    model: 'PurchaseOrder',
    select: 'orderNumber status vendor totalAmount workflowHistory createdAt',
    populate: { path: 'vendor', select: 'name' },
    number: (d) => d.orderNumber,
    title: (d) => d.vendor?.name,
    amount: (d) => d.totalAmount,
    stage: (d) => (['Received', 'Cancelled', 'Rejected'].includes(d.status) ? null : d.status)
  },
  {
    key: 'cash_approval',
    label: 'Cash Approval',
    model: 'CashApproval',
    select: 'caNumber purpose status totalAmount departmentApprovalChain workflowHistory createdAt',
    number: (d) => d.caNumber,
    title: (d) => d.purpose,
    amount: (d) => d.totalAmount,
    link: (d) => `/general/cash-approvals/${d._id}`,
    stage: (d) => (['Completed', 'Cancelled', 'Rejected'].includes(d.status) ? null : d.status)
  },
  {
    key: 'vendor_bill',
    label: 'Vendor Bill',
    model: 'AccountsPayable',
    select: 'billNumber vendor.name status approvalStatus approvalChain totalAmount voidedAt workflowHistory createdAt',
    number: (d) => d.billNumber,
    title: (d) => d.vendor?.name,
    amount: (d) => d.totalAmount,
    stage: (d) => {
      if (d.voidedAt || ['paid', 'cancelled'].includes(d.status)) return null;
      if (d.status === 'draft') return d.approvalStatus === 'Submitted' ? 'Pending Department Approval' : 'Draft';
      if (d.status === 'received') return 'Bill Received';
      if (['approved', 'partial', 'overdue'].includes(d.status)) return 'Awaiting Payment';
      return d.status;
    }
  },
  {
    key: 'utility_bill',
    label: 'Utility Bill',
    model: 'UtilityBill',
    select: 'billId provider utilityType amount status approvalStatus approvalChain workflowHistory createdAt',
    number: (d) => d.billId,
    title: (d) => [d.utilityType, d.provider].filter(Boolean).join(' · '),
    amount: (d) => d.amount,
    link: (d) => `/finance/utility-bills/${d._id}`,
    stage: (d) => {
      if (d.approvalStatus === 'Submitted') return 'Pending Department Approval';
      if (d.approvalStatus === 'Draft') return 'Draft';
      return null;
    }
  },
  {
    key: 'rental',
    label: 'Rental Payment',
    model: 'RentalManagement',
    select: 'parentCompanyName subsidiaryName site amount status approvalStatus approvalChain workflowHistory createdAt',
    number: (d) => d.site || d.subsidiaryName,
    title: (d) => d.subsidiaryName || d.parentCompanyName,
    amount: (d) => Number(d.amount) || 0,
    stage: (d) => {
      if (['Paid', 'Rejected'].includes(d.status)) return null;
      if (d.status === 'Approved') return 'Awaiting Payment';
      if (d.status === 'Submitted') return 'Pending Department Approval';
      return d.status;
    }
  },
  {
    key: 'payment_settlement',
    label: 'Payment Settlement',
    model: 'PaymentSettlement',
    select: 'parentCompanyName subsidiaryName site amount status approvalStatus approvalChain workflowHistory createdAt',
    number: (d) => d.site || d.subsidiaryName,
    title: (d) => d.subsidiaryName || d.parentCompanyName,
    amount: (d) => Number(d.amount) || 0,
    stage: (d) => {
      if (['Paid', 'Rejected'].includes(d.status)) return null;
      if (d.status === 'Approved') return 'Awaiting Payment';
      if (d.status === 'Submitted') return 'Pending Department Approval';
      return d.status;
    }
  }
];

const toTime = (v) => {
  const t = v ? new Date(v).getTime() : NaN;
  return Number.isFinite(t) ? t : null;
};

const sameStatus = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

const round1 = (n) => Math.round(n * 10) / 10;

// ───────────────────────────── Document flow (full trail of one document) ─────────────────────────────

const { buildVendorBillFullWorkflowHistory, buildIndentWorkflowHistory, tagEntries } = require('../utils/vendorBillWorkflowHistory');

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const USER_FIELDS = 'firstName lastName';
const personName = (u) => (u && typeof u === 'object' && (u.firstName || u.lastName) ? `${u.firstName || ''} ${u.lastName || ''}`.trim() : '');

/** Every document kind that can appear in a flow, in the order the business process runs. */
const FLOW_KINDS = {
  indent: {
    order: 1,
    label: 'Indent',
    model: 'Indent',
    searchFields: ['indentNumber', 'title'],
    populate: [
      { path: 'department', select: 'name' },
      { path: 'requestedBy', select: USER_FIELDS },
      { path: 'createdBy', select: USER_FIELDS }
    ],
    number: (d) => d.indentNumber,
    title: (d) => d.title,
    amount: (d) => d.totalEstimatedCost,
    status: (d) => d.status,
    date: (d) => d.createdAt,
    party: (d) => [d.department?.name, personName(d.requestedBy || d.createdBy)].filter(Boolean).join(' · '),
    link: (d) => `/general/indents/${d._id}`,
    events: (d) => buildIndentWorkflowHistory(d)
  },
  quotation: {
    order: 2,
    label: 'Quotation',
    model: 'Quotation',
    searchFields: ['quotationNumber'],
    populate: [{ path: 'vendor', select: 'name' }],
    number: (d) => d.quotationNumber,
    title: (d) => d.vendor?.name,
    amount: (d) => d.totalAmount,
    status: (d) => d.status,
    date: (d) => d.quotationDate || d.createdAt,
    party: (d) => d.vendor?.name || '',
    events: (d) => [
      {
        fromStatus: '—',
        toStatus: 'Quotation Received',
        changedBy: d.createdBy,
        changedAt: d.createdAt,
        comments: `Quotation from ${d.vendor?.name || 'vendor'}${d.status === 'Finalized' ? ' (finalized)' : ''}`,
        module: 'Procurement'
      }
    ]
  },
  purchase_order: {
    order: 3,
    label: 'Purchase Order',
    model: 'PurchaseOrder',
    searchFields: ['orderNumber'],
    populate: [{ path: 'vendor', select: 'name' }],
    number: (d) => d.orderNumber,
    title: (d) => d.vendor?.name,
    amount: (d) => d.totalAmount,
    status: (d) => d.status,
    date: (d) => d.createdAt,
    party: (d) => d.vendor?.name || '',
    events: (d) => [
      {
        fromStatus: '—',
        toStatus: 'PO Created',
        changedBy: d.createdBy,
        changedAt: d.createdAt,
        comments: `Purchase order raised${d.vendor?.name ? ` on ${d.vendor.name}` : ''}`,
        module: 'Procurement'
      },
      ...tagEntries(d.workflowHistory, 'Procurement')
    ]
  },
  cash_approval: {
    order: 3,
    label: 'Cash Approval',
    model: 'CashApproval',
    searchFields: ['caNumber', 'purpose'],
    populate: [{ path: 'vendor', select: 'name' }],
    number: (d) => d.caNumber,
    title: (d) => d.purpose,
    amount: (d) => d.totalAmount,
    status: (d) => d.status,
    date: (d) => d.createdAt,
    party: (d) => d.vendor?.name || '',
    link: (d) => `/general/cash-approvals/${d._id}`,
    events: (d) => [
      {
        fromStatus: '—',
        toStatus: 'Cash Approval Created',
        changedBy: d.createdBy,
        changedAt: d.createdAt,
        comments: d.purpose || 'Cash approval request created',
        module: 'Cash Approval'
      },
      ...tagEntries(d.workflowHistory, 'Cash Approval')
    ]
  },
  grn: {
    order: 4,
    label: 'GRN',
    model: 'GoodsReceive',
    searchFields: ['receiveNumber', 'supplierName'],
    populate: [],
    number: (d) => d.receiveNumber,
    title: (d) => d.supplierName,
    amount: (d) => d.netAmount || d.total,
    status: (d) => d.status,
    date: (d) => d.receiveDate || d.createdAt,
    party: (d) => d.supplierName || '',
    events: (d) => [
      {
        fromStatus: '—',
        toStatus: 'Goods Received',
        changedBy: d.receivedBy,
        changedAt: d.createdAt || d.receiveDate,
        comments: `GRN ${d.receiveNumber || ''} — goods received in Store${d.supplierName ? ` from ${d.supplierName}` : ''}`.trim(),
        module: 'Store'
      }
    ]
  },
  utility_bill: {
    order: 4,
    label: 'Utility Bill',
    model: 'UtilityBill',
    searchFields: ['billId', 'provider'],
    populate: [],
    number: (d) => d.billId,
    title: (d) => [d.utilityType, d.provider].filter(Boolean).join(' · '),
    amount: (d) => d.amount,
    status: (d) => d.approvalStatus || d.status,
    date: (d) => d.createdAt,
    party: (d) => d.provider || '',
    link: (d) => `/finance/utility-bills/${d._id}`,
    events: (d) => [
      {
        fromStatus: '—',
        toStatus: 'Bill Created',
        changedBy: d.createdBy,
        changedAt: d.createdAt,
        comments: 'Utility bill entered',
        module: 'Admin'
      },
      ...tagEntries(d.workflowHistory, 'Admin')
    ]
  },
  vendor_bill: {
    order: 5,
    label: 'Vendor Bill',
    model: 'AccountsPayable',
    searchFields: ['billNumber', 'vendor.name'],
    populate: [],
    number: (d) => d.billNumber,
    title: (d) => d.vendor?.name,
    amount: (d) => d.totalAmount,
    status: (d) => (d.voidedAt ? 'voided' : d.status),
    date: (d) => d.billDate || d.createdAt,
    party: (d) => d.vendor?.name || '',
    events: (d) => buildVendorBillFullWorkflowHistory({ bill: d })
  }
};

const idStr = (v) => (v && typeof v === 'object' && v._id ? String(v._id) : v ? String(v) : null);

/** Follow every link out of a set of documents until the whole chain is collected. */
const collectFlow = async (startKind, startId) => {
  const found = {};
  Object.keys(FLOW_KINDS).forEach((k) => { found[k] = new Map(); });
  let queue = [[startKind, String(startId)]];
  const M = (name) => mongoose.model(name);
  const MAX_DOCS = 150;
  let total = 0;

  const loadByIds = async (kind, ids) => {
    const fresh = [...new Set(ids.filter(Boolean).map(String))].filter(
      (id) => mongoose.isValidObjectId(id) && !found[kind].has(id)
    );
    if (!fresh.length) return [];
    let q = M(FLOW_KINDS[kind].model).find({ _id: { $in: fresh } });
    FLOW_KINDS[kind].populate.forEach((p) => { q = q.populate(p); });
    const docs = await q.lean();
    docs.forEach((d) => found[kind].set(String(d._id), d));
    total += docs.length;
    return docs;
  };
  const idsWhere = async (kind, filter) =>
    (await M(FLOW_KINDS[kind].model).find(filter).select('_id').limit(60).lean()).map((d) => String(d._id));

  for (let round = 0; round < 6 && queue.length && total < MAX_DOCS; round += 1) {
    const byKind = {};
    queue.forEach(([k, id]) => { (byKind[k] = byKind[k] || []).push(id); });
    queue = [];
    const push = (kind, ids) => ids.forEach((id) => id && !found[kind].has(String(id)) && queue.push([kind, String(id)]));

    for (const [kind, ids] of Object.entries(byKind)) {
      const docs = await loadByIds(kind, ids);
      const docIds = docs.map((d) => d._id);
      if (!docs.length) continue;

      if (kind === 'indent') {
        push('quotation', await idsWhere('quotation', { indent: { $in: docIds } }));
        push('purchase_order', await idsWhere('purchase_order', { indent: { $in: docIds } }));
        push('cash_approval', await idsWhere('cash_approval', { indent: { $in: docIds } }));
      }
      if (kind === 'quotation') {
        push('indent', docs.map((d) => idStr(d.indent)));
        push('purchase_order', await idsWhere('purchase_order', { quotation: { $in: docIds } }));
        push('cash_approval', await idsWhere('cash_approval', { quotation: { $in: docIds } }));
      }
      if (kind === 'purchase_order') {
        push('indent', docs.map((d) => idStr(d.indent)));
        push('quotation', docs.map((d) => idStr(d.quotation)));
        push('grn', await idsWhere('grn', { purchaseOrder: { $in: docIds } }));
        push('vendor_bill', await idsWhere('vendor_bill', {
          $or: [
            { 'linkedGRNs.poId': { $in: docIds } },
            { referenceType: 'purchase_order', referenceId: { $in: docIds } }
          ]
        }));
      }
      if (kind === 'cash_approval') {
        push('indent', docs.map((d) => idStr(d.indent)));
        push('quotation', docs.map((d) => idStr(d.quotation)));
        push('vendor_bill', await idsWhere('vendor_bill', { 'employeeAdvanceAllocations.cashApprovalId': { $in: docIds } }));
      }
      if (kind === 'grn') {
        push('purchase_order', docs.map((d) => idStr(d.purchaseOrder)));
        push('vendor_bill', docs.map((d) => idStr(d.vendorBill)));
        push('vendor_bill', await idsWhere('vendor_bill', {
          $or: [{ 'linkedGRNs.grnId': { $in: docIds } }, { referenceType: 'grn', referenceId: { $in: docIds } }]
        }));
      }
      if (kind === 'utility_bill') {
        push('vendor_bill', await idsWhere('vendor_bill', { referenceType: 'utility_bill', referenceId: { $in: docIds } }));
      }
      if (kind === 'vendor_bill') {
        docs.forEach((d) => {
          (d.linkedGRNs || []).forEach((g) => { push('grn', [idStr(g.grnId)]); push('purchase_order', [idStr(g.poId)]); });
          (d.employeeAdvanceAllocations || []).forEach((a) => push('cash_approval', [idStr(a.cashApprovalId)]));
          if (d.referenceType === 'purchase_order') push('purchase_order', [idStr(d.referenceId)]);
          if (d.referenceType === 'grn') push('grn', [idStr(d.referenceId)]);
          if (d.referenceType === 'utility_bill') push('utility_bill', [idStr(d.referenceId)]);
        });
      }
    }
  }
  return found;
};

// @route   GET /api/general-reports/document-flow/search?q=
// @desc    Find a document (indent, PO, cash approval, GRN, bill…) to trace
router.get(
  '/document-flow/search',
  authorize('super_admin', 'higher_management', 'admin'),
  asyncHandler(async (req, res) => {
    const q = String(req.query.q || '').trim();
    const kinds = Object.entries(FLOW_KINDS).filter(([k]) => !req.query.kind || req.query.kind === k);
    const perKind = q ? 8 : 4;
    const results = await Promise.all(
      kinds.map(async ([kind, cfg]) => {
        const filter = q ? { $or: cfg.searchFields.map((f) => ({ [f]: new RegExp(escapeRegex(q), 'i') })) } : {};
        let query = mongoose.model(cfg.model).find(filter).sort({ createdAt: -1 }).limit(perKind);
        cfg.populate.forEach((p) => { query = query.populate(p); });
        const docs = await query.lean();
        return docs.map((d) => ({
          kind,
          kindLabel: cfg.label,
          id: String(d._id),
          number: cfg.number(d) || String(d._id).slice(-6).toUpperCase(),
          title: cfg.title(d) || '',
          status: cfg.status(d) || '',
          date: cfg.date(d) || d.createdAt
        }));
      })
    );
    const flat = results.flat().sort((a, b) => (toTime(b.date) || 0) - (toTime(a.date) || 0));
    res.json({ success: true, data: flat });
  })
);

// @route   GET /api/general-reports/document-flow/:kind/:id
// @desc    Full flow of one document: every linked document and every step, in order
router.get(
  '/document-flow/:kind/:id',
  authorize('super_admin', 'higher_management', 'admin'),
  asyncHandler(async (req, res) => {
    const { kind, id } = req.params;
    if (!FLOW_KINDS[kind] || !mongoose.isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: 'Unknown document' });
    }
    const found = await collectFlow(kind, id);
    if (!found[kind].has(String(id))) {
      return res.status(404).json({ success: false, message: 'Document not found' });
    }

    const userIds = new Set();
    const documents = [];
    const events = [];

    Object.entries(found).forEach(([k, map]) => {
      const cfg = FLOW_KINDS[k];
      map.forEach((d) => {
        const docKey = `${k}:${d._id}`;
        const number = cfg.number(d) || String(d._id).slice(-6).toUpperCase();
        documents.push({
          key: docKey,
          kind: k,
          kindLabel: cfg.label,
          order: cfg.order,
          id: String(d._id),
          number,
          title: cfg.title(d) || '',
          party: cfg.party(d) || '',
          status: cfg.status(d) || '',
          amount: Number(cfg.amount(d)) || 0,
          date: cfg.date(d) || d.createdAt,
          link: cfg.link ? cfg.link(d) : null,
          isStart: k === kind && String(d._id) === String(id)
        });
        (cfg.events(d) || []).forEach((e) => {
          const at = toTime(e.changedAt);
          if (at === null) return;
          const by = e.changedBy;
          const byName = personName(by);
          const byId = byName ? null : idStr(by);
          if (byId && mongoose.isValidObjectId(byId)) userIds.add(byId);
          events.push({
            docKey,
            kind: k,
            kindLabel: cfg.label,
            number,
            order: cfg.order,
            at,
            fromStatus: e.fromStatus || '—',
            toStatus: e.toStatus || '—',
            module: e.module || cfg.label,
            comments: e.comments ? String(e.comments).trim() : '',
            byName,
            byId
          });
        });
      });
    });

    const users = userIds.size
      ? await mongoose.model('User').find({ _id: { $in: [...userIds] } }).select(USER_FIELDS).lean()
      : [];
    const names = new Map(users.map((u) => [String(u._id), personName(u)]));

    events.sort((a, b) => a.at - b.at || a.order - b.order);
    // The same step can be recorded twice (stored history + a synthetic entry) — keep one
    const seenStep = new Map();
    const uniqueEvents = events.filter((e) => {
      const key = `${e.docKey}|${e.toStatus}|${e.comments}`;
      const prev = seenStep.get(key);
      seenStep.set(key, e.at);
      return prev === undefined || e.at - prev > 5000;
    });
    const lastAtByDoc = new Map();
    const timeline = uniqueEvents.map((e, i) => {
      const prevSameDoc = lastAtByDoc.get(e.docKey);
      lastAtByDoc.set(e.docKey, e.at);
      return {
        step: i + 1,
        docKey: e.docKey,
        kind: e.kind,
        kindLabel: e.kindLabel,
        number: e.number,
        at: new Date(e.at).toISOString(),
        fromStatus: e.fromStatus,
        toStatus: e.toStatus,
        module: e.module,
        comments: e.comments,
        by: e.byName || names.get(e.byId) || '',
        isReturn: RETURN_OR_REJECT_RE.test(e.toStatus),
        // time this document sat in the previous status before this step happened
        minutesSincePrevious: prevSameDoc !== undefined ? Math.round((e.at - prevSameDoc) / 60000) : null
      };
    });

    documents.sort((a, b) => a.order - b.order || (toTime(a.date) || 0) - (toTime(b.date) || 0));
    documents.forEach((d) => {
      const own = timeline.filter((t) => t.docKey === d.key);
      d.steps = own.length;
      d.firstAt = own[0]?.at || null;
      d.lastAt = own[own.length - 1]?.at || null;
    });

    const first = timeline[0];
    const last = timeline[timeline.length - 1];
    const departments = new Map();
    timeline.forEach((t) => {
      if (t.minutesSincePrevious === null) return;
      const m = departments.get(t.module) || { module: t.module, steps: 0, minutes: 0 };
      m.steps += 1;
      m.minutes += t.minutesSincePrevious;
      departments.set(t.module, m);
    });

    res.json({
      success: true,
      data: {
        start: documents.find((d) => d.isStart),
        documents,
        timeline,
        summary: {
          startedAt: first?.at || null,
          startedBy: first?.by || '',
          startedIn: first ? `${first.kindLabel} ${first.number}` : '',
          lastActionAt: last?.at || null,
          lastAction: last ? `${last.kindLabel} ${last.number}: ${last.toStatus}` : '',
          lastActionBy: last?.by || '',
          totalMinutes: first && last ? Math.round((toTime(last.at) - toTime(first.at)) / 60000) : 0,
          steps: timeline.length,
          returns: timeline.filter((t) => t.isReturn).length,
          documents: documents.length
        },
        timeByDepartment: [...departments.values()].sort((a, b) => b.minutes - a.minutes)
      }
    });
  })
);

// ───────────────────────────── Flow register (one row per document, in bulk) ─────────────────────────────

const REGISTER_KINDS = ['indent', 'purchase_order', 'cash_approval', 'vendor_bill', 'utility_bill'];
const REGISTER_MAX_ROWS = 2000;
const REGISTER_MAX_STAGE_COLUMNS = 18;

/** Collapse a document's raw events into the stages it passed through, in order. */
const stageVisits = (events, nowMs, isOpen) => {
  const sorted = events
    .map((e) => ({ ...e, at: toTime(e.changedAt) }))
    .filter((e) => e.at !== null && e.toStatus)
    .sort((a, b) => a.at - b.at);
  const visits = [];
  sorted.forEach((e) => {
    const last = visits[visits.length - 1];
    if (last && sameStatus(last.stage, e.toStatus)) {
      if (e.comments && String(e.comments).trim()) last.remark = String(e.comments).trim();
      return;
    }
    if (last) last.minutes = Math.round((e.at - last.at) / 60000);
    visits.push({
      stage: String(e.toStatus).trim(),
      at: e.at,
      by: e.changedBy,
      remark: e.comments ? String(e.comments).trim() : '',
      module: e.module || '',
      minutes: null
    });
  });
  const tail = visits[visits.length - 1];
  if (tail && isOpen) tail.minutes = Math.round((nowMs - tail.at) / 60000);
  return visits;
};

// @route   GET /api/general-reports/flow-register?kind=&from=&to=&q=&state=
// @desc    Every document of one type with its full flow on a single row
router.get(
  '/flow-register',
  authorize('super_admin', 'higher_management', 'admin'),
  asyncHandler(async (req, res) => {
    const kind = REGISTER_KINDS.includes(req.query.kind) ? req.query.kind : 'purchase_order';
    const cfg = FLOW_KINDS[kind];
    const tracker = DOC_TYPES.find((t) => t.key === kind);
    const now = Date.now();
    const to = toTime(req.query.to) !== null ? toTime(req.query.to) + DAY_MS - 1 : now;
    const from = toTime(req.query.from) !== null ? toTime(req.query.from) : to - 90 * DAY_MS;
    const state = ['open', 'completed'].includes(req.query.state) ? req.query.state : 'all';
    const q = String(req.query.q || '').trim();

    const filter = { createdAt: { $gte: new Date(from), $lte: new Date(to) } };
    if (q) filter.$or = cfg.searchFields.map((f) => ({ [f]: new RegExp(escapeRegex(q), 'i') }));

    const Model = mongoose.model(cfg.model);
    let query = Model.find(filter).sort({ createdAt: -1 }).limit(REGISTER_MAX_ROWS + 1);
    cfg.populate.forEach((p) => { query = query.populate(p); });
    if (kind === 'purchase_order' || kind === 'cash_approval') query = query.populate({ path: 'indent', select: 'indentNumber' });
    let docs = await query.lean();
    const truncated = docs.length > REGISTER_MAX_ROWS;
    docs = docs.slice(0, REGISTER_MAX_ROWS);

    // Numbers of the documents each row is linked to
    const linkedByDoc = new Map();
    const addLink = (id, text) => {
      if (!text) return;
      const key = String(id);
      if (!linkedByDoc.has(key)) linkedByDoc.set(key, new Set());
      linkedByDoc.get(key).add(text);
    };
    const ids = docs.map((d) => d._id);
    if (kind === 'indent' && ids.length) {
      const pos = await mongoose.model('PurchaseOrder').find({ indent: { $in: ids } }).select('orderNumber indent').lean();
      pos.forEach((p) => addLink(p.indent, p.orderNumber));
      const cas = await mongoose.model('CashApproval').find({ indent: { $in: ids } }).select('caNumber indent').lean();
      cas.forEach((c) => addLink(c.indent, c.caNumber));
    }
    if (kind === 'purchase_order' && ids.length) {
      docs.forEach((d) => addLink(d._id, d.indent?.indentNumber ? `Indent ${d.indent.indentNumber}` : ''));
      const grns = await mongoose.model('GoodsReceive').find({ purchaseOrder: { $in: ids } }).select('receiveNumber purchaseOrder vendorBillNumber').lean();
      grns.forEach((g) => { addLink(g.purchaseOrder, g.receiveNumber); addLink(g.purchaseOrder, g.vendorBillNumber); });
    }
    if (kind === 'cash_approval') {
      docs.forEach((d) => addLink(d._id, d.indent?.indentNumber ? `Indent ${d.indent.indentNumber}` : ''));
    }
    if (kind === 'vendor_bill') {
      docs.forEach((d) => {
        (d.linkedGRNs || []).forEach((g) => { addLink(d._id, g.poNumber); addLink(d._id, g.grnNumber); });
        (d.employeeAdvanceAllocations || []).forEach((a) => addLink(d._id, a.caNumber));
      });
    }

    const userIds = new Set();
    const noteUser = (u) => {
      if (personName(u)) return;
      const uid = idStr(u);
      if (uid && mongoose.isValidObjectId(uid)) userIds.add(uid);
    };

    const stageStats = new Map();
    let rows = docs.map((d) => {
      const currentStage = tracker ? tracker.stage(d) : null;
      const isOpen = Boolean(currentStage);
      const visits = stageVisits(cfg.events(d) || [], now, isOpen);
      visits.forEach((v, i) => {
        noteUser(v.by);
        const st = stageStats.get(v.stage) || { stage: v.stage, docs: 0, positionSum: 0, modules: {} };
        if (v.module) st.modules[v.module] = (st.modules[v.module] || 0) + 1;
        st.positionSum += i / Math.max(1, visits.length - 1);
        st.docs += 1;
        stageStats.set(v.stage, st);
      });
      const first = visits[0];
      const last = visits[visits.length - 1];
      return {
        id: String(d._id),
        kind,
        number: cfg.number(d) || String(d._id).slice(-6).toUpperCase(),
        title: cfg.title(d) || '',
        party: cfg.party(d) || '',
        amount: Number(cfg.amount(d)) || 0,
        status: cfg.status(d) || '',
        isOpen,
        currentStage: currentStage || '',
        pendingWith: isOpen ? ownerOf(currentStage) : '',
        createdAt: d.createdAt,
        link: cfg.link ? cfg.link(d) : null,
        linked: [...(linkedByDoc.get(String(d._id)) || [])].join(', '),
        initiatedAt: first ? new Date(first.at).toISOString() : d.createdAt,
        lastActionAt: last ? new Date(last.at).toISOString() : null,
        totalMinutes: first && last ? Math.round(((isOpen ? now : last.at) - first.at) / 60000) : 0,
        returns: visits.filter((v) => RETURN_OR_REJECT_RE.test(v.stage)).length,
        visits
      };
    });

    if (state === 'open') rows = rows.filter((r) => r.isOpen);
    if (state === 'completed') rows = rows.filter((r) => !r.isOpen);

    const users = userIds.size
      ? await mongoose.model('User').find({ _id: { $in: [...userIds] } }).select(USER_FIELDS).lean()
      : [];
    const names = new Map(users.map((u) => [String(u._id), personName(u)]));
    const nameFor = (u) => personName(u) || names.get(idStr(u)) || '';

    rows.forEach((r) => {
      r.visits = r.visits.map((v) => ({
        stage: v.stage,
        at: new Date(v.at).toISOString(),
        by: nameFor(v.by),
        minutes: v.minutes,
        remark: v.remark,
        module: v.module
      }));
      r.initiatedBy = r.visits[0]?.by || '';
      r.lastActionBy = r.visits[r.visits.length - 1]?.by || '';
      r.lastRemark = [...r.visits].reverse().find((v) => v.remark)?.remark || '';
    });

    // Stage columns: the most common stages, in the order documents usually reach them
    const stageColumns = [...stageStats.values()]
      .sort((a, b) => b.docs - a.docs)
      .slice(0, REGISTER_MAX_STAGE_COLUMNS)
      .sort((a, b) => a.positionSum / a.docs - b.positionSum / b.docs)
      .map((s) => s.stage);

    // Department / desk responsible for each stage (falls back to the module that recorded it)
    const stageOwners = {};
    stageStats.forEach((st, stage) => {
      const known = ownerOf(stage);
      const topModule = Object.entries(st.modules).sort((x, y) => y[1] - x[1])[0]?.[0] || '';
      // "Approved" only means "back with Procurement" on a purchase order
      if (stage === 'Approved' && kind !== 'purchase_order') {
        stageOwners[stage] = kind === 'indent' ? 'Store' : topModule || known;
        return;
      }
      stageOwners[stage] = known !== 'Unassigned' ? known : topModule;
    });
    rows.forEach((r) => {
      if (r.currentStage && !stageOwners[r.currentStage]) stageOwners[r.currentStage] = r.pendingWith;
    });

    res.json({
      success: true,
      data: {
        stageOwners,
        kind,
        kindLabel: cfg.label,
        kinds: REGISTER_KINDS.map((k) => ({ key: k, label: FLOW_KINDS[k].label })),
        period: { from: new Date(from).toISOString(), to: new Date(to).toISOString() },
        generatedAt: new Date(now).toISOString(),
        stageColumns,
        rows,
        truncated
      }
    });
  })
);

module.exports = router;
