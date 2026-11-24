/**
 * Customer project statement (Finance → Customers → Cost Center tab).
 *
 * A customer's project is its cost center: the one(s) on its invoices. From the posted books it collects
 *   income  — every invoice (not cancelled) and every receipt against those invoices
 *   costs   — every posted entry tagged to that cost center that is not the customer's own invoice/receipt:
 *             vendor bills, vendor advances, bank payments to vendors, journal vouchers
 * and works out
 *   project cost   = expenses booked on the cost center + vendor advances paid but not yet billed
 *   paid to vendors = money that left bank / cash on those entries
 *   profit          = invoiced − project cost
 * An advance that is later set off against a bill is counted once: as an open advance before the bill,
 * as the bill's expense after it.
 */
const mongoose = require('mongoose');
const JournalEntry = require('../models/finance/JournalEntry');
const Account = require('../models/finance/Account');
const VendorAdvance = require('../models/finance/VendorAdvance');
const AccountsPayable = require('../models/finance/AccountsPayable');
const FinanceCostCenter = require('../models/finance/CostCenter');

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const CLOSING_REF = /^CLOSE-/;
const isCashAccount = (a) => a && a.type === 'Asset'
  && (['Bank', 'Cash and Cash Equivalents', 'Cash on hand'].includes(a.detailType) || /^cash/i.test(a.category || ''));

async function buildCustomerProjectStatement({ invoices = [], payments = [], ccIds = [], companyId = null }) {
  const ids = ccIds.map((id) => new mongoose.Types.ObjectId(String(id)));
  const idSet = new Set(ids.map(String));
  const invoiceIds = new Set(invoices.map((i) => String(i._id)));

  const costCenters = ids.length
    ? (await FinanceCostCenter.find({ _id: { $in: ids } }).select('code name').lean())
      .map((c) => ({ _id: c._id, code: c.code || '', name: c.name || '' }))
    : [];

  // ── Income: invoices and receipts ──
  const entries = [];
  let invoiced = 0;
  let received = 0;
  invoices.filter((i) => i.status !== 'cancelled').forEach((inv) => {
    invoiced += Number(inv.totalAmount) || 0;
    entries.push({
      kind: 'invoice', type: 'Invoice', date: inv.invoiceDate || inv.createdAt, voucher: inv.invoiceNumber,
      party: '', description: inv.description || (inv.lineItems || []).map((l) => l.description).filter(Boolean).join('; ') || '',
      invoiced: r2(inv.totalAmount), received: 0, cost: 0, paidOut: 0
    });
  });
  payments.forEach((p) => {
    received += Number(p.amount) || 0;
    entries.push({
      kind: 'receipt', type: 'Receipt', date: p.paymentDate, voucher: p.receiptNumber || '', reference: p.reference || '',
      party: '', description: `Received against ${p.invoiceNumber || 'invoice'}`,
      invoiced: 0, received: r2(p.amount), cost: 0, paidOut: 0
    });
  });

  // ── Costs: posted entries tagged to the project's cost center ──
  let expensesBooked = 0;
  let paidToVendors = 0;
  let taggedJeIds = [];
  if (ids.length) {
    const match = {
      status: 'posted',
      reference: { $not: CLOSING_REF },
      $or: [{ costCenter: { $in: ids } }, { 'lines.costCenter': { $in: ids } }]
    };
    if (companyId) match.companyId = companyId;
    const jes = (await JournalEntry.find(match)
      .select('entryNumber date description reference referenceType referenceId costCenter lines.account lines.debit lines.credit lines.costCenter lines.description')
      .sort({ date: 1 })
      .lean())
      // The customer's own invoices and receipts are already listed as income
      .filter((je) => !['invoice', 'receipt'].includes(je.referenceType)
        && !(je.referenceId && invoiceIds.has(String(je.referenceId))));
    taggedJeIds = jes.map((je) => je._id);

    const accountIds = [...new Set(jes.flatMap((je) => (je.lines || []).map((l) => String(l.account))))];
    const accounts = new Map((await Account.find({ _id: { $in: accountIds } }).select('type detailType category name accountNumber').lean())
      .map((a) => [String(a._id), a]));

    const refIds = jes.map((je) => je.referenceId).filter(Boolean);
    const [bills, advances] = await Promise.all([
      refIds.length ? AccountsPayable.find({ _id: { $in: refIds } }).select('billNumber vendor').lean() : [],
      refIds.length ? VendorAdvance.find({ _id: { $in: refIds } }).select('vendor').lean() : []
    ]);
    const billById = new Map(bills.map((b) => [String(b._id), b]));
    const advById = new Map(advances.map((a) => [String(a._id), a]));

    jes.forEach((je) => {
      const headerTagged = je.costCenter && idSet.has(String(je.costCenter));
      const lines = (je.lines || []).filter((l) => (l.costCenter ? idSet.has(String(l.costCenter)) : headerTagged));
      let cost = 0;
      let paidOut = 0;
      lines.forEach((l) => {
        const a = accounts.get(String(l.account));
        if (a?.type === 'Expense') cost += (Number(l.debit) || 0) - (Number(l.credit) || 0);
        if (isCashAccount(a)) paidOut += (Number(l.credit) || 0) - (Number(l.debit) || 0);
      });
      const ref = je.referenceId ? String(je.referenceId) : '';
      const bill = billById.get(ref);
      const adv = advById.get(ref);
      const type = je.referenceType === 'bill' ? 'Vendor bill'
        : adv ? 'Vendor advance'
          : je.referenceType === 'payment' ? 'Vendor payment'
            : 'Journal voucher';
      expensesBooked += cost;
      paidToVendors += paidOut;
      entries.push({
        kind: 'cost', type, date: je.date, voucher: je.entryNumber, reference: bill?.billNumber || je.reference || '',
        party: bill?.vendor?.name || adv?.vendor?.name || '',
        description: je.description || '',
        invoiced: 0, received: 0, cost: r2(cost), paidOut: r2(paidOut), journalEntryId: je._id
      });
    });
  }

  // ── Vendor advances paid for this project and not yet set off against a bill ──
  let openAdvances = 0;
  if (ids.length) {
    const advQ = {
      status: { $ne: 'applied' },
      voucherWorkflowStatus: { $ne: 'rejected' },
      $or: [{ costCenter: { $in: ids } }, ...(taggedJeIds.length ? [{ journalEntryId: { $in: taggedJeIds } }] : [])]
    };
    if (companyId) advQ.companyId = companyId;
    const advs = await VendorAdvance.find(advQ).select('amount appliedAmount journalEntryId').lean();
    const advJe = advs.map((a) => a.journalEntryId).filter(Boolean);
    const posted = new Set(advJe.length
      ? (await JournalEntry.find({ _id: { $in: advJe }, status: 'posted' }).select('_id').lean()).map((j) => String(j._id))
      : []);
    advs.forEach((a) => {
      if (a.journalEntryId && !posted.has(String(a.journalEntryId))) return;
      openAdvances += Math.max(0, (Number(a.amount) || 0) - (Number(a.appliedAmount) || 0));
    });
  }

  // Dated list with a running cash position (received − paid to vendors)
  entries.sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));
  let cash = 0;
  entries.forEach((e) => {
    cash += (e.received || 0) - (e.paidOut || 0);
    e.cashPosition = r2(cash);
  });

  const projectCost = r2(expensesBooked + openAdvances);
  const profit = r2(invoiced - projectCost);
  return {
    costCenters,
    hasCostCenter: ids.length > 0,
    summary: {
      invoiced: r2(invoiced),
      received: r2(received),
      outstanding: r2(invoiced - received),
      expensesBooked: r2(expensesBooked),
      openAdvances: r2(openAdvances),
      projectCost,
      paidToVendors: r2(paidToVendors),
      cashPosition: r2(received - paidToVendors),
      profit,
      profitPercent: invoiced > 0 ? Math.round((profit / invoiced) * 10000) / 100 : 0
    },
    entries
  };
}

module.exports = { buildCustomerProjectStatement };
