/**
 * Post CEO-approved Subcontractor IPCs to Finance (Accounts Payable + GL), and mirror
 * Finance payments back onto the IPC.
 *
 *   DR  Work in Progress (construction cost)        gross certified work
 *   CR  Accounts Payable — subcontractor            gross − retention − advance recovery
 *   CR  Retention Payable — Subcontractors          retention held
 *   CR  Advance to Suppliers / Contractors          advance recovered
 *
 * WHT is not booked here: Finance deducts it when paying the AP bill (its normal payment step),
 * so the AP bill carries the WHT rate the project proposed in its notes.
 */

require('../models/finance/FiscalPeriod');
require('../models/finance/FinanceJournal');

const Account = require('../models/finance/Account');
const AccountsPayable = require('../models/finance/AccountsPayable');
const ProjectInvoice = require('../models/projectManagement/ProjectInvoice');
const ConstructionProject = require('../models/projectManagement/ConstructionProject');
const Supplier = require('../models/hr/Supplier');
const User = require('../models/User');
const FinanceHelper = require('./financeHelper');
const { acct, withCompany } = require('./financePosting');
const { createAndEmitNotification } = require('../services/realtimeNotificationService');

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const RETENTION_ACCOUNT_NAME = 'Retention Payable - Subcontractors';

/** Company-scoped account lookup by name pattern (falls back to a known number whose name still matches). */
const findAccount = async (companyId, { type, name, number }) => {
  const base = { companyId, isActive: { $ne: false }, type };
  const byName = await Account.findOne({ ...base, name }).sort({ accountNumber: 1 });
  if (byName) return byName;
  if (number) return Account.findOne({ ...base, accountNumber: number });
  return null;
};

/** Retention is a standard construction liability; create it on the company's chart the first time it is needed. */
const resolveRetentionAccount = async (companyId) => {
  const existing = await findAccount(companyId, { type: 'Liability', name: /retention/i });
  if (existing) return existing;
  for (let n = 2170; n < 2200; n += 1) {
    const taken = await Account.exists({ companyId, accountNumber: String(n) });
    if (taken) continue;
    return Account.create({
      companyId,
      accountNumber: String(n),
      name: RETENTION_ACCOUNT_NAME,
      type: 'Liability',
      category: 'Current Liability',
      description: 'Retention money held from subcontractor IPCs until the defects liability period ends',
      isActive: true
    });
  }
  return null;
};

const resolveProjectCompanyId = async (project) => {
  if (project?.companyId) return project.companyId;
  if (project?.parentProject) {
    const main = await ConstructionProject.findById(project.parentProject).select('companyId').lean();
    return main?.companyId || null;
  }
  return null;
};

const financeRecipients = async () => {
  const users = await User.find({ isActive: true, role: { $in: ['finance_manager', 'admin', 'super_admin'] } }).select('_id').lean();
  return users.map((u) => String(u._id));
};

/**
 * Create the AP bill + journal for an approved IPC. Idempotent: an IPC already linked to an AP bill is left alone.
 * Records any failure on the IPC (financePostingError) so Finance can fix the chart and retry.
 * @returns {{ posted: boolean, apId?: string, billNumber?: string, error?: string, skipped?: boolean }}
 */
const postIpcToFinance = async (invoiceId, actorId) => {
  const invoice = await ProjectInvoice.findById(invoiceId);
  if (!invoice) return { posted: false, error: 'IPC not found' };
  if (invoice.invoiceType !== 'Subcontractor_IPC') return { posted: false, skipped: true, error: 'Not a subcontractor IPC' };
  if (invoice.approvalStatus !== 'Approved') return { posted: false, skipped: true, error: 'IPC is not CEO-approved yet' };
  if (invoice.financeApBillId) {
    return { posted: true, skipped: true, apId: String(invoice.financeApBillId), billNumber: invoice.financeBillNumber };
  }

  const fail = async (error) => {
    invoice.financePostingError = error;
    await invoice.save();
    return { posted: false, error };
  };

  const [project, contractor] = await Promise.all([
    ConstructionProject.findById(invoice.project).populate('parentProject', 'name').lean(),
    Supplier.findById(invoice.contractor).select('name email phone').lean()
  ]);
  if (!contractor) return fail('Subcontractor (supplier) record not found');

  const companyId = await resolveProjectCompanyId(project);
  if (!companyId) return fail('Set the Finance company on the Main Project so this IPC can post to its chart of accounts');

  const kind = invoice.ipcKind || 'Work';
  const isWork = kind === 'Work';
  const gross = round2(invoice.grossAmount || invoice.invoiceAmount);
  // Advances and retention releases pay their full amount; only Work IPCs carry deductions
  const retention = isWork ? round2(invoice.retentionAmount) : 0;
  const advance = isWork ? round2(invoice.advanceRecoveryAmount) : 0;
  const apAmount = round2(gross - retention - advance);
  if (gross <= 0 || apAmount < 0) return fail('IPC amounts are not valid for posting');

  const A = acct(companyId);
  const findAdvanceAccount = () => findAccount(companyId, { type: 'Asset', name: /advance.*(supplier|contractor)/i });
  const [debitAcc, ap, retentionAcc, advanceAcc] = await Promise.all([
    kind === 'Advance' ? findAdvanceAccount()
      : kind === 'Retention Release' ? resolveRetentionAccount(companyId)
        : findAccount(companyId, { type: 'Asset', name: /work\s*in\s*progress|\bwip\b|construction\s*in\s*progress|capital\s*work/i, number: '1210' }),
    A.resolve(FinanceHelper.ACCOUNTS.PAYABLE),
    retention > 0 ? resolveRetentionAccount(companyId) : null,
    advance > 0 ? findAdvanceAccount() : null
  ]);
  if (!debitAcc) {
    return fail(kind === 'Advance'
      ? 'No "Advance to Suppliers / Contractors" asset account on this company\'s chart of accounts'
      : kind === 'Retention Release'
        ? 'Could not find or create a Retention Payable account'
        : 'No "Work in Progress" asset account on this company\'s chart of accounts');
  }
  const wip = debitAcc;
  if (!ap) return fail('No Accounts Payable (2001) account on this company\'s chart of accounts');
  if (retention > 0 && !retentionAcc) return fail('Could not find or create a Retention Payable account');
  if (advance > 0 && !advanceAcc) return fail('No "Advance to Suppliers / Contractors" asset account for the advance recovery');

  let billNumber = `IPC-${invoice.invoiceNumber}`;
  if (await AccountsPayable.exists({ billNumber })) billNumber = `${billNumber}-${Date.now().toString().slice(-5)}`;

  const projectLabel = [project?.parentProject?.name, project?.name].filter(Boolean).join(' / ');
  const billDate = invoice.ceoApprovedAt || new Date();
  const dueDate = invoice.dueDate && new Date(invoice.dueDate) >= billDate
    ? invoice.dueDate
    : new Date(billDate.getTime() + 30 * 24 * 60 * 60 * 1000);
  const notes = [
    `Subcontractor ${kind === 'Work' ? 'IPC' : kind} #${invoice.ipcNumber} (${invoice.invoiceNumber}) — ${projectLabel}`,
    isWork
      ? `Gross certified ${gross}; retention ${retention} (${invoice.retentionPercentage || 0}%) held; advance recovered ${advance}.`
      : kind === 'Advance'
        ? `Mobilisation advance ${gross}, recovered at ${invoice.advanceRecoveryPercent || 0}% of later IPCs.`
        : `Release of retention money held: ${gross}.`,
    invoice.whtPercentage ? `Deduct WHT @ ${invoice.whtPercentage}% when paying (proposed by Project Management).` : '',
    `CEO approved ${billDate.toISOString().slice(0, 10)}.`
  ].filter(Boolean).join(' ');

  let apEntry = null;
  try {
    apEntry = await FinanceHelper.createAPFromBill({
      companyId,
      vendorName: contractor.name,
      vendorEmail: contractor.email || '',
      vendorId: contractor._id,
      billNumber,
      vendorInvoiceNumber: invoice.invoiceNumber,
      billDate,
      dueDate,
      amount: apAmount,
      department: 'project_management',
      module: 'project_management',
      referenceId: invoice._id,
      referenceType: 'project_ipc',
      lineItems: [{
        description: `IPC #${invoice.ipcNumber} — ${invoice.description || projectLabel}`.slice(0, 250),
        quantity: 1,
        unitPrice: apAmount
      }],
      notes,
      createdBy: actorId,
      project: projectLabel,
      skipJournal: true
    });

    const lines = [
      {
        account: wip._id,
        description: (kind === 'Advance' ? `Advance to ${contractor.name}` : kind === 'Retention Release' ? `Retention released to ${contractor.name}` : 'Subcontract work certified')
          + ` — ${invoice.invoiceNumber}`,
        debit: gross,
        department: 'project_management'
      },
      { account: ap._id, description: `Payable to ${contractor.name}`, credit: apAmount, department: 'project_management' }
    ];
    if (retention > 0) lines.push({ account: retentionAcc._id, description: `Retention held — ${contractor.name}`, credit: retention, department: 'project_management' });
    if (advance > 0) lines.push({ account: advanceAcc._id, description: `Advance recovered — ${contractor.name}`, credit: advance, department: 'project_management' });

    await FinanceHelper.createAndPostJournalEntry(withCompany({
      date: billDate,
      reference: billNumber,
      description: `Subcontractor IPC ${invoice.invoiceNumber} — ${contractor.name}`,
      department: 'project_management',
      module: 'project_management',
      referenceId: apEntry._id,
      referenceType: 'bill',
      journalCode: 'PURCH',
      voucherSeries: 'BILL',
      createdBy: actorId,
      lines
    }, companyId));
  } catch (err) {
    // Never leave an AP bill without its journal
    if (apEntry?._id) await AccountsPayable.deleteOne({ _id: apEntry._id }).catch(() => {});
    console.error('[projectIpcFinance] posting failed:', err);
    return fail(`Finance posting failed: ${err.message}`);
  }

  invoice.financeApBillId = apEntry._id;
  invoice.financeBillNumber = billNumber;
  invoice.financePostedAt = new Date();
  invoice.financePostingError = '';
  invoice.workflowHistory.push({
    fromStatus: 'Approved',
    toStatus: 'Approved',
    changedBy: actorId,
    comments: `Posted to Finance: AP ${billNumber} — DR ${wip.name} ${gross} / CR AP ${apAmount}${retention ? ` / CR Retention ${retention}` : ''}${advance ? ` / CR Advance ${advance}` : ''}`,
    module: 'Finance'
  });
  await invoice.save();

  try {
    await createAndEmitNotification({
      recipientIds: await financeRecipients(),
      title: 'Subcontractor IPC ready for payment',
      message: `IPC ${invoice.invoiceNumber} (${contractor.name}) — PKR ${apAmount.toLocaleString()} posted to Accounts Payable as ${billNumber}.`,
      type: 'info',
      category: 'approval',
      priority: 'high',
      actionUrl: '/finance/accounts-payable',
      createdBy: actorId,
      excludeUserId: actorId,
      metadata: { module: 'finance', entityId: apEntry._id, entityType: 'AccountsPayable' }
    });
  } catch (notifyErr) {
    console.error('[projectIpcFinance] notification failed:', notifyErr.message);
  }

  return { posted: true, apId: String(apEntry._id), billNumber };
};

/**
 * After Finance pays (fully or partly) an AP bill that came from an IPC, mirror it on the IPC.
 * Called from the AP payment application flow.
 */
const syncIpcFromApPayment = async (apBill) => {
  if (!apBill || apBill.referenceType !== 'project_ipc' || !apBill.referenceId) return { synced: 0 };
  const invoice = await ProjectInvoice.findById(apBill.referenceId);
  if (!invoice || invoice.status === 'Cancelled') return { synced: 0 };

  const settled = round2((Number(apBill.amountPaid) || 0) + (Number(apBill.advanceApplied) || 0));
  const payable = round2(FinanceHelper.getAPPayableBase(apBill));
  const isPaid = apBill.status === 'paid' || (payable > 0 && settled >= payable - 0.01);
  if (!isPaid && settled <= 0.01) return { synced: 0 };

  invoice.payments = (apBill.payments || []).map((p) => ({
    amount: round2(p.amount),
    paidDate: p.paymentDate || new Date(),
    paymentMethod: p.paymentMethod || '',
    paymentReference: p.reference || apBill.billNumber,
    recordedBy: p.createdBy || undefined
  })).filter((p) => p.amount > 0);
  invoice.paidAmount = settled;
  invoice.paidDate = invoice.payments.length ? invoice.payments[invoice.payments.length - 1].paidDate : new Date();
  invoice.status = isPaid ? 'Paid' : 'Partially Paid';
  await invoice.save();
  return { synced: 1 };
};

module.exports = {
  postIpcToFinance,
  syncIpcFromApPayment,
  resolveProjectCompanyId,
  RETENTION_ACCOUNT_NAME
};
