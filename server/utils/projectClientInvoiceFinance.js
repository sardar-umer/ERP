/**
 * Client invoices (Project Management) → Finance Accounts Receivable.
 *
 *   On "Sent":   DR Accounts Receivable  /  CR Contract Revenue (falls back to Sales Revenue 4001)
 *   On cancel:   the AR is cancelled and the journal reversed (only while nothing has been received)
 *   On receipt:  Finance records the receipt on the AR as usual; the client invoice mirrors it.
 */
const mongoose = require('mongoose');
const Account = require('../models/finance/Account');
const AccountsReceivable = require('../models/finance/AccountsReceivable');
const JournalEntry = require('../models/finance/JournalEntry');
const ProjectInvoice = require('../models/projectManagement/ProjectInvoice');
const ConstructionProject = require('../models/projectManagement/ConstructionProject');
const { acct, withCompany } = require('./financePosting');

// FinanceHelper requires this module's caller chain; load lazily to avoid a require cycle
const finance = () => require('./financeHelper');

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const resolveCompanyId = async (projectId) => {
  const project = await ConstructionProject.findById(projectId).select('companyId parentProject').lean();
  if (project?.companyId) return project.companyId;
  if (project?.parentProject) {
    const main = await ConstructionProject.findById(project.parentProject).select('companyId').lean();
    return main?.companyId || null;
  }
  return null;
};

const resolveRevenueAccount = async (companyId) => {
  const base = { companyId, isActive: { $ne: false }, type: 'Revenue' };
  return (await Account.findOne({ ...base, name: /contract\s*revenue|construction\s*revenue|project\s*revenue/i }))
    || (await acct(companyId).resolve('4001'))
    || Account.findOne({ ...base, name: /sales\s*revenue/i });
};

/**
 * Post a client invoice to Finance as an AR invoice with its journal. Idempotent.
 * @returns {{ posted: boolean, arId?: string, error?: string, skipped?: boolean }}
 */
const postClientInvoiceToFinance = async (invoiceId, actorId) => {
  const invoice = await ProjectInvoice.findById(invoiceId);
  if (!invoice) return { posted: false, error: 'Invoice not found' };
  if (invoice.invoiceType !== 'Client_Invoice') return { posted: false, skipped: true, error: 'Not a client invoice' };
  if (invoice.financeArId) return { posted: true, skipped: true, arId: String(invoice.financeArId), arNumber: invoice.financeArNumber };
  // Only the CEO's approval sends a client invoice to Finance
  if (invoice.approvalStatus !== 'Approved') return { posted: false, skipped: true, error: 'Client invoice is not CEO-approved yet' };

  const fail = async (error) => {
    invoice.financePostingError = error;
    await invoice.save();
    return { posted: false, error };
  };

  const amount = round2(invoice.invoiceAmount || invoice.grossAmount);
  if (amount <= 0) return fail('Invoice amount must be greater than zero');
  if (!String(invoice.clientName || '').trim()) return fail('Set the client name on the invoice before sending it');
  const companyId = await resolveCompanyId(invoice.project);
  if (!companyId) return fail('Set the Finance company on the Main Project so the invoice can post to its accounts');

  const [arAccount, revenue] = await Promise.all([
    acct(companyId).resolve(finance().ACCOUNTS.RECEIVABLE),
    resolveRevenueAccount(companyId)
  ]);
  if (!arAccount) return fail('No Accounts Receivable (1100) account on this company\'s chart of accounts');
  if (!revenue) return fail('No revenue account (Contract Revenue / Sales Revenue 4001) on this company\'s chart of accounts');

  const project = await ConstructionProject.findById(invoice.project).populate('parentProject', 'name').select('name parentProject').lean();
  const projectLabel = [project?.parentProject?.name, project?.name].filter(Boolean).join(' / ');
  let arNumber = `CI-${invoice.invoiceNumber}`;
  if (await AccountsReceivable.exists({ invoiceNumber: arNumber })) arNumber = `${arNumber}-${Date.now().toString().slice(-5)}`;
  const invoiceDate = invoice.issueDate || new Date();
  const dueDate = invoice.dueDate || new Date(new Date(invoiceDate).getTime() + 30 * 24 * 60 * 60 * 1000);

  const lineItems = (invoice.items || []).length
    ? invoice.items.map((i) => ({
        description: `${i.title || i.description || 'Work'}${i.unit ? ` (${i.unit})` : ''}`.slice(0, 250),
        quantity: Number(i.currentQuantity) || 1,
        unitPrice: round2(i.currentQuantity ? i.currentAmount / i.currentQuantity : i.currentAmount),
        amount: round2(i.currentAmount)
      }))
    : [{ description: (invoice.description || `Client invoice — ${projectLabel}`).slice(0, 250), quantity: 1, unitPrice: amount, amount }];

  let ar = null;
  try {
    ar = await AccountsReceivable.create({
      companyId,
      customer: { name: invoice.clientName.trim(), email: '', },
      invoiceNumber: arNumber,
      invoiceDate,
      dueDate,
      subtotal: amount,
      totalAmount: amount,
      lineItems,
      status: 'sent',
      department: 'project_management',
      module: 'project_management',
      referenceId: invoice._id,
      referenceType: 'project',
      notes: `Project Management client invoice ${invoice.invoiceNumber} — ${projectLabel}${invoice.description ? ` — ${invoice.description}` : ''}`,
      createdBy: actorId
    });
    await finance().createAndPostJournalEntry(withCompany({
      date: invoiceDate,
      reference: arNumber,
      description: `Client invoice ${invoice.invoiceNumber} — ${invoice.clientName} (${projectLabel})`,
      department: 'project_management',
      module: 'project_management',
      referenceId: ar._id,
      referenceType: 'invoice',
      createdBy: actorId,
      lines: [
        { account: arAccount._id, description: `Receivable from ${invoice.clientName}`, debit: amount, department: 'project_management' },
        { account: revenue._id, description: `Contract revenue — ${invoice.invoiceNumber}`, credit: amount, department: 'project_management' }
      ]
    }, companyId));
  } catch (err) {
    if (ar?._id) await AccountsReceivable.deleteOne({ _id: ar._id }).catch(() => {});
    console.error('[projectClientInvoiceFinance] posting failed:', err);
    return fail(`Finance posting failed: ${err.message}`);
  }

  invoice.financeArId = ar._id;
  invoice.financeArNumber = arNumber;
  invoice.financePostedAt = new Date();
  invoice.financePostingError = '';
  await invoice.save();
  return { posted: true, arId: String(ar._id), arNumber };
};

/**
 * Cancelling a sent client invoice: cancel its AR and reverse the journal. Refused once Finance has received money.
 * @returns {{ ok: boolean, error?: string }}
 */
const reverseClientInvoiceInFinance = async (invoice, actorId) => {
  if (!invoice.financeArId) return { ok: true };
  const ar = await AccountsReceivable.findById(invoice.financeArId);
  if (!ar || ar.status === 'cancelled') return { ok: true };
  if ((Number(ar.amountPaid) || 0) > 0) {
    return { ok: false, error: `Finance has already received ${ar.amountPaid} against ${ar.invoiceNumber} — it can't be cancelled` };
  }
  const je = await JournalEntry.findOne({ referenceId: ar._id, status: 'posted' }).lean();
  if (je) {
    await finance().createAndPostJournalEntry(withCompany({
      date: new Date(),
      reference: `${ar.invoiceNumber}-REV`,
      description: `Reversal — client invoice ${invoice.invoiceNumber} cancelled`,
      department: 'project_management',
      module: 'project_management',
      referenceId: ar._id,
      referenceType: 'invoice',
      createdBy: actorId,
      lines: je.lines.map((l) => ({
        account: l.account,
        description: `Reversal: ${l.description || ''}`.slice(0, 200),
        debit: Number(l.credit) || 0,
        credit: Number(l.debit) || 0,
        department: 'project_management'
      }))
    }, ar.companyId));
  }
  ar.status = 'cancelled';
  await ar.save();
  return { ok: true };
};

/** After Finance records a receipt on an AR invoice that came from Project Management, mirror it on the client invoice */
const syncClientInvoiceFromAr = async (ar) => {
  if (!ar || ar.referenceType !== 'project' || !ar.referenceId) return { synced: 0 };
  if (!mongoose.Types.ObjectId.isValid(String(ar.referenceId))) return { synced: 0 };
  const invoice = await ProjectInvoice.findOne({ _id: ar.referenceId, invoiceType: 'Client_Invoice' });
  if (!invoice || invoice.status === 'Cancelled') return { synced: 0 };
  const received = round2(ar.amountPaid);
  if (received <= 0) return { synced: 0 };
  invoice.payments = (ar.payments || []).map((p) => ({
    amount: round2(p.amount),
    paidDate: p.paymentDate || new Date(),
    paymentMethod: p.paymentMethod || '',
    paymentReference: p.reference || ar.invoiceNumber
  })).filter((p) => p.amount > 0);
  invoice.paidAmount = received;
  invoice.paidDate = invoice.payments.length ? invoice.payments[invoice.payments.length - 1].paidDate : new Date();
  invoice.status = received >= round2(invoice.invoiceAmount) - 0.01 ? 'Paid' : 'Partially Paid';
  await invoice.save();
  return { synced: 1 };
};

module.exports = { postClientInvoiceToFinance, reverseClientInvoiceInFinance, syncClientInvoiceFromAr };
