/**
 * Payables Hub — one list of everything the company owes, from every module, for the accountant.
 *
 * Sources: vendor bills (AP: manual, PO/GRN, utility, settlement, subcontractor IPC), cash approvals at Finance,
 * PO advances awaiting Finance, and GRNs received but not yet billed. Payroll is paid from its own queue.
 * Each row has the same shape and a stage:
 *   awaiting_bill → awaiting_approval → ready_to_pay → in_payment_approval → paid
 * `action` says which existing payment window the hub opens for the row (pay_bill = Vendor Bills payment dialog,
 * cash_approval = the Cash Approval Finance step, po_advance = Vendor Advance); the hub never posts payments itself.
 */
const mongoose = require('mongoose');
const AccountsPayable = require('../models/finance/AccountsPayable');
const ApPaymentApplication = require('../models/finance/ApPaymentApplication');
const CashApproval = require('../models/procurement/CashApproval');
const PurchaseOrder = require('../models/procurement/PurchaseOrder');
const GoodsReceive = require('../models/procurement/GoodsReceive');
const { getBillPayState, getPoAdvancePayState } = require('./apBillPayState');
const VendorAdvance = require('../models/finance/VendorAdvance');
const { vendorAdvancesLinkedToPurchaseOrderFilter } = require('./fullAdvancePoGate');

const DAY = 24 * 60 * 60 * 1000;
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const AP_SOURCE = {
  purchase_order: { key: 'purchase', label: 'Purchase (PO)' },
  grn: { key: 'purchase', label: 'Purchase (GRN)' },
  utility_bill: { key: 'utility', label: 'Utility / store bill' },
  project_ipc: { key: 'ipc', label: 'Subcontractor IPC' },
  manual: { key: 'vendor_bill', label: 'Vendor bill' },
  bill: { key: 'vendor_bill', label: 'Vendor bill' },
  service: { key: 'vendor_bill', label: 'Vendor bill' },
  product: { key: 'vendor_bill', label: 'Vendor bill' }
};
const AP_AWAITING_APPROVAL = ['draft', 'Pending Audit', 'Forwarded to Audit Director', 'Returned from Audit', 'Returned from Finance'];
const CA_FINANCE_STATUSES = ['Pending Finance', 'Finance Authority Approved', 'Advance Issued', 'Evidence Submitted', 'Payment Settled'];

const row = (r) => {
  const balance = round2(r.balance ?? (r.amount - (r.paid || 0)));
  const due = r.dueDate ? new Date(r.dueDate) : null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return {
    ...r,
    amount: round2(r.amount),
    paid: round2(r.paid),
    balance,
    overdue: Boolean(due && due < today && balance > 0.01 && ['ready_to_pay', 'in_payment_approval'].includes(r.stage)),
    ageDays: r.date ? Math.max(0, Math.floor((Date.now() - new Date(r.date)) / DAY)) : null
  };
};

/**
 * @param {{ companyId?: string, paidDays?: number }} opts
 */
const buildPayablesHub = async ({ companyId = null, paidDays = 60 } = {}) => {
  const cid = companyId && mongoose.Types.ObjectId.isValid(String(companyId)) ? new mongoose.Types.ObjectId(String(companyId)) : null;
  const scoped = (q) => (cid ? { ...q, companyId: cid } : q);
  const paidSince = new Date(Date.now() - paidDays * DAY);

  const [bills, pendingApps, cashApprovals, poAdvances, grnsToBill] = await Promise.all([
    AccountsPayable.find(scoped({
      status: { $ne: 'cancelled' },
      $or: [{ status: { $ne: 'paid' } }, { updatedAt: { $gte: paidSince } }]
    }))
      .select('billNumber vendor vendorInvoiceNumber billDate dueDate totalAmount duePaymentAmount amountPaid advanceApplied paymentPending advancePending status approvalStatus referenceType referenceId linkedGRNs companyId project notes updatedAt isAdvanceBill')
      .populate('companyId', 'name')
      .sort({ dueDate: 1 })
      .limit(2000)
      .lean(),
    ApPaymentApplication.find({ workflowStatus: 'pending_authority' }).select('accountsPayableId bills amount').lean(),
    CashApproval.find(scoped({
      status: { $in: CA_FINANCE_STATUSES },
      $or: [{ status: { $in: ['Pending Finance', 'Finance Authority Approved'] } }, { updatedAt: { $gte: paidSince } }]
    }))
      .select('caNumber status totalAmount advanceAmount vendor advanceToName purpose approvalDate updatedAt companyId requestingDepartment voucherEntryId advanceIssuedAt evidenceSubmittedAt')
      .populate('vendor', 'name').populate('companyId', 'name')
      .limit(500)
      .lean(),
    PurchaseOrder.find(scoped({ status: 'Pending Finance' }))
      .select('orderNumber vendor totalAmount orderDate expectedDeliveryDate companyId status paymentTerms')
      .populate('vendor', 'name').populate('companyId', 'name')
      .limit(500)
      .lean(),
    GoodsReceive.find({ billingStatus: 'waiting_bills' })
      .select('receiveNumber grnNumber totalAmount billedAmount receiveDate supplier vendor purchaseOrder')
      .populate('purchaseOrder', 'orderNumber vendor companyId')
      .limit(500)
      .lean()
      .catch(() => [])
  ]);

  // Bills already in a payment awaiting finance authority
  const inApproval = new Map();
  pendingApps.forEach((a) => {
    const lines = (a.bills || []).length ? a.bills : [{ billId: a.accountsPayableId, amount: a.amount }];
    lines.forEach((l) => inApproval.set(String(l.billId), (inApproval.get(String(l.billId)) || 0) + (Number(l.amount) || 0)));
  });

  // PO / GRN numbers for the document trail
  const poIds = bills.filter((b) => b.referenceType === 'purchase_order').map((b) => b.referenceId);
  const grnIds = bills.filter((b) => b.referenceType === 'grn').map((b) => b.referenceId)
    .concat(bills.flatMap((b) => (b.linkedGRNs || []).map((g) => g.grn || g.grnId || g)));
  const [pos, grns] = await Promise.all([
    PurchaseOrder.find({ _id: { $in: poIds } }).select('orderNumber').lean(),
    GoodsReceive.find({ _id: { $in: grnIds.filter((id) => mongoose.Types.ObjectId.isValid(String(id))) } })
      .select('receiveNumber grnNumber purchaseOrder').populate('purchaseOrder', 'orderNumber').lean()
  ]);
  const poById = new Map(pos.map((p) => [String(p._id), p]));
  const grnById = new Map(grns.map((g) => [String(g._id), g]));

  const rows = [];

  bills.forEach((b) => {
    const src = b.isAdvanceBill ? { key: 'vendor_bill', label: 'Advance bill' } : (AP_SOURCE[b.referenceType] || AP_SOURCE.manual);
    // Same pay rule as Vendor Bills: at Finance, and something left after payments already created
    const payState = getBillPayState(b);
    const payable = payState.payable;
    const paid = payState.settled;
    const balance = payState.balance;
    const approving = Math.max(payState.pending, inApproval.get(String(b._id)) || 0);
    const stage = balance <= 0.01 ? 'paid'
      : AP_AWAITING_APPROVAL.includes(b.status) || ['Submitted', 'Rejected'].includes(b.approvalStatus) ? 'awaiting_approval'
        : payState.canPay ? 'ready_to_pay'
          : 'in_payment_approval';
    const grnDoc = b.referenceType === 'grn' ? grnById.get(String(b.referenceId)) : null;
    const linkedGrns = (b.linkedGRNs || []).map((g) => grnById.get(String(g.grn || g.grnId || g))).filter(Boolean);
    const trail = [
      b.referenceType === 'purchase_order' && poById.get(String(b.referenceId)) && { type: 'PO', number: poById.get(String(b.referenceId)).orderNumber },
      grnDoc?.purchaseOrder?.orderNumber && { type: 'PO', number: grnDoc.purchaseOrder.orderNumber },
      grnDoc && { type: 'GRN', number: grnDoc.receiveNumber || grnDoc.grnNumber },
      ...linkedGrns.map((g) => ({ type: 'GRN', number: g.receiveNumber || g.grnNumber })),
      b.vendorInvoiceNumber && { type: 'Vendor invoice', number: b.vendorInvoiceNumber },
      { type: 'Bill', number: b.billNumber }
    ].filter(Boolean).filter((t, i, all) => all.findIndex((x) => x.type === t.type && x.number === t.number) === i);
    rows.push(row({
      key: `ap:${b._id}`,
      id: b._id,
      source: src.key,
      sourceLabel: src.label,
      number: b.billNumber,
      party: b.vendor?.name || '—',
      vendorId: b.vendor?.vendorId ? String(b.vendor.vendorId) : null,
      company: b.companyId?.name || '',
      companyId: b.companyId?._id || b.companyId || null,
      project: b.project || '',
      date: b.billDate,
      dueDate: b.dueDate,
      amount: payable,
      paid,
      balance,
      inApprovalAmount: round2(approving),
      stage,
      payableInHub: stage === 'ready_to_pay',
      action: stage === 'ready_to_pay' ? 'pay_bill' : null,
      trail,
      link: `/finance/accounts-payable?search=${encodeURIComponent(b.billNumber)}`
    }));
  });

  cashApprovals.forEach((ca) => {
    const amount = Number(ca.advanceAmount) || Number(ca.totalAmount) || 0;
    const issued = ['Advance Issued', 'Evidence Submitted', 'Payment Settled'].includes(ca.status);
    // The Finance step due now, matching the Cash Approvals screen's own actions
    const settling = ca.status === 'Pending Finance' && ca.advanceIssuedAt && ca.evidenceSubmittedAt;
    const step = issued ? null
      : settling ? { stage: 'ready_to_pay', note: 'Evidence submitted — settle payment' }
        : ca.status === 'Finance Authority Approved' ? { stage: 'ready_to_pay', note: 'Authorities approved — post the payment' }
          : !ca.voucherEntryId ? { stage: 'ready_to_pay', note: 'Create the payment voucher' }
            : { stage: 'in_payment_approval', note: 'Voucher created — awaiting finance authorities' };
    rows.push(row({
      key: `ca:${ca._id}`,
      id: ca._id,
      source: 'cash_approval',
      sourceLabel: 'Cash approval',
      number: ca.caNumber,
      party: ca.advanceToName || ca.vendor?.name || ca.requestingDepartment || '—',
      vendorId: ca.vendor?._id ? String(ca.vendor._id) : null,
      company: ca.companyId?.name || '',
      companyId: ca.companyId?._id || ca.companyId || null,
      date: ca.approvalDate || ca.updatedAt,
      dueDate: null,
      amount,
      paid: issued || settling ? amount : 0,
      balance: issued || settling ? 0 : amount,
      stage: step ? step.stage : 'paid',
      note: step ? step.note : ca.status,
      payableInHub: false,
      action: step ? 'cash_approval' : null,
      trail: [{ type: 'Cash approval', number: ca.caNumber }],
      link: '/finance/cash-approvals'
    }));
  });

  // PO advances: same queue as Vendor Advance (full-advance terms, balance left after advances already recorded)
  const poAdvanceRows = poAdvances.length
    ? await VendorAdvance.find({ ...vendorAdvancesLinkedToPurchaseOrderFilter(null), referenceId: { $in: poAdvances.flatMap((p) => [p._id, String(p._id)]) } })
      .select('referenceId amount voucherWorkflowStatus').lean()
    : [];
  const advancesByPo = new Map();
  poAdvanceRows.forEach((a) => {
    const k = String(a.referenceId);
    if (!advancesByPo.has(k)) advancesByPo.set(k, []);
    advancesByPo.get(k).push(a);
  });
  poAdvances.forEach((po) => {
    const st = getPoAdvancePayState(po, advancesByPo.get(String(po._id)) || []);
    if (st.reason === 'PO is not on advance payment terms') return;
    if (st.remaining <= 0.009 && st.pending <= 0.009) return;
    rows.push(row({
      key: `po:${po._id}`,
      id: po._id,
      source: 'po_advance',
      sourceLabel: 'PO advance',
      number: po.orderNumber,
      party: po.vendor?.name || '—',
      vendorId: po.vendor?._id ? String(po.vendor._id) : null,
      company: po.companyId?.name || '',
      companyId: po.companyId?._id || po.companyId || null,
      date: po.orderDate,
      dueDate: po.expectedDeliveryDate || null,
      amount: st.total,
      paid: st.paid,
      balance: round2(st.total - st.paid),
      inApprovalAmount: st.pending,
      stage: st.canPay ? 'ready_to_pay' : 'in_payment_approval',
      note: st.canPay ? `CEO-approved PO on advance terms — ${st.committed > 0 ? `${round2(st.remaining)} advance still due` : 'pay the vendor advance'}` : st.reason,
      payableInHub: false,
      action: st.canPay ? 'po_advance' : null,
      trail: [{ type: 'PO', number: po.orderNumber }],
      link: '/finance/vendor-advance'
    }));
  });

  grnsToBill
    .filter((g) => !cid || String(g.purchaseOrder?.companyId || '') === String(cid))
    .forEach((g) => {
      const open = round2((Number(g.totalAmount) || 0) - (Number(g.billedAmount) || 0));
      if (open <= 0.01) return;
      rows.push(row({
        key: `grn:${g._id}`,
        id: g._id,
        source: 'purchase',
        sourceLabel: 'Received, not billed',
        number: g.receiveNumber || g.grnNumber,
        party: g.supplier?.name || g.vendor?.name || g.purchaseOrder?.vendor?.name || '—',
        vendorId: g.purchaseOrder?.vendor ? String(g.purchaseOrder.vendor._id || g.purchaseOrder.vendor) : null,
        date: g.receiveDate,
        dueDate: null,
        amount: open,
        paid: 0,
        stage: 'awaiting_bill',
        note: 'Goods received — Procurement enters the vendor bill',
        payableInHub: false,
        trail: [g.purchaseOrder?.orderNumber && { type: 'PO', number: g.purchaseOrder.orderNumber }, { type: 'GRN', number: g.receiveNumber || g.grnNumber }].filter(Boolean),
        link: '/finance/bill-to-receive'
      }));
    });

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const in7 = new Date(today.getTime() + 7 * DAY);
  const open = rows.filter((r) => r.stage !== 'paid');
  const sum = (list) => round2(list.reduce((t, r) => t + (Number(r.balance) || 0), 0));
  const summary = {
    totalOpen: sum(open.filter((r) => r.stage !== 'awaiting_bill')),
    readyToPay: sum(rows.filter((r) => r.stage === 'ready_to_pay')),
    overdue: sum(rows.filter((r) => r.overdue)),
    dueIn7Days: sum(rows.filter((r) => r.stage === 'ready_to_pay' && r.dueDate && new Date(r.dueDate) <= in7)),
    inPaymentApproval: sum(rows.filter((r) => r.stage === 'in_payment_approval')),
    awaitingApproval: sum(rows.filter((r) => r.stage === 'awaiting_approval')),
    awaitingBill: sum(rows.filter((r) => r.stage === 'awaiting_bill')),
    paidRecently: round2(rows.filter((r) => r.stage === 'paid').reduce((t, r) => t + (Number(r.paid) || 0), 0)),
    counts: rows.reduce((acc, r) => { acc[r.stage] = (acc[r.stage] || 0) + 1; return acc; }, {})
  };

  return { rows, summary, generatedAt: new Date() };
};

/** Things the accountant should fix: documents not in the ledger, companies without fiscal periods */
const buildHubWarnings = async () => {
  const GoodsIssue = require('../models/procurement/GoodsIssue');
  const ProjectInvoice = require('../models/projectManagement/ProjectInvoice');
  const FiscalPeriod = require('../models/finance/FiscalPeriod');
  const [sinCount, pmCount, companies, withPeriods] = await Promise.all([
    GoodsIssue.countDocuments({ financePostingStatus: { $in: ['failed', 'partial', 'not_posted'] } }),
    ProjectInvoice.countDocuments({
      approvalStatus: 'Approved',
      status: { $ne: 'Cancelled' },
      $or: [{ invoiceType: 'Subcontractor_IPC', financeApBillId: null }, { invoiceType: 'Client_Invoice', financeArId: null }]
    }),
    mongoose.connection.collection('placementcompanies').find({ isActive: { $ne: false } }).project({ name: 1 }).toArray(),
    FiscalPeriod.distinct('companyId')
  ]);
  const periodSet = new Set(withPeriods.map(String));
  return {
    postingExceptions: sinCount + pmCount,
    companiesWithoutFiscalPeriods: companies.filter((c) => !periodSet.has(String(c._id))).map((c) => c.name)
  };
};

module.exports = { buildPayablesHub, buildHubWarnings };
