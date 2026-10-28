const Account = require('../models/finance/Account');

const STANDARD_SYSTEM_ACCOUNTS = [
  { accountNumber: '1001', accountCode: 'CASH', name: 'Cash', type: 'Asset', category: 'Current Asset', detailType: 'Cash and Cash Equivalents', isSystem: true },
  { accountNumber: '1002', accountCode: 'BANK', name: 'Bank Account', type: 'Asset', category: 'Current Asset', detailType: 'Bank', isSystem: true },
  { accountNumber: '1100', accountCode: 'RECEIVABLE', name: 'Accounts Receivable', type: 'Asset', category: 'Current Asset', detailType: 'Accounts Receivable', isSystem: true },
  { accountNumber: '1110', accountCode: 'VENDOR_ADVANCE', name: 'Advance to Suppliers', type: 'Asset', category: 'Current Asset', detailType: 'Other Current Assets', isSystem: true },
  { accountNumber: '1120', accountCode: 'STAFF_ADVANCE', name: 'Cash Advance to Staff', type: 'Asset', category: 'Current Asset', detailType: 'Other Current Assets', isSystem: true },
  { accountNumber: '1125', accountCode: 'EMPLOYEE_LOAN', name: 'Employee Loan Receivable', type: 'Asset', category: 'Current Asset', detailType: 'Other Current Assets', isSystem: true },
  { accountNumber: '1200', accountCode: 'INVENTORY', name: 'Inventory', type: 'Asset', category: 'Current Asset', detailType: 'Inventory Asset', isSystem: true },
  { accountNumber: '2001', accountCode: 'PAYABLE', name: 'Accounts Payable', type: 'Liability', category: 'Current Liability', detailType: 'Accounts Payable', isSystem: true },
  { accountNumber: '2004', accountCode: 'WHT_PAYABLE', name: 'WHT Payable', type: 'Liability', category: 'Current Liability', detailType: 'Other Current Liabilities', isSystem: true },
  { accountNumber: '2100', accountCode: 'GRNI', name: 'GRNI Clearing', type: 'Liability', category: 'Current Liability', detailType: 'Other Current Liabilities', isSystem: true },
  { accountNumber: '2140', accountCode: 'GRNI_ALT', name: 'GRNI – Goods Received Not Invoiced', type: 'Liability', category: 'Current Liability', detailType: 'Other Current Liabilities', isSystem: true },
  { accountNumber: '2200', accountCode: 'SALARIES_PAYABLE', name: 'Salaries Payable', type: 'Liability', category: 'Current Liability', detailType: 'Other Current Liabilities', isSystem: true },
  { accountNumber: '2210', accountCode: 'PF_PAYABLE', name: 'Provident Fund Payable', type: 'Liability', category: 'Current Liability', detailType: 'Other Current Liabilities', isSystem: true },
  { accountNumber: '2211', accountCode: 'EOBI_PAYABLE', name: 'EOBI Payable', type: 'Liability', category: 'Current Liability', detailType: 'Other Current Liabilities', isSystem: true },
  { accountNumber: '2212', accountCode: 'OTHER_PAYROLL_DED', name: 'Other Payroll Deductions Payable', type: 'Liability', category: 'Current Liability', detailType: 'Other Current Liabilities', isSystem: true },
  { accountNumber: '3001', accountCode: 'SHARE_CAPITAL', name: 'Share Capital', type: 'Equity', category: 'Equity', detailType: "Owner's Equity", isSystem: false },
  { accountNumber: '3002', accountCode: 'RETAINED_EARNINGS', name: 'Retained Earnings', type: 'Equity', category: 'Equity', detailType: 'Retained Earnings', isSystem: true },
  { accountNumber: '4001', accountCode: 'SALES_REVENUE', name: 'Sales Revenue', type: 'Revenue', category: 'Operating Revenue', detailType: 'Sales', isSystem: true },
  { accountNumber: '4010', accountCode: 'REVENUE_CAM', name: 'CAM Revenue', type: 'Revenue', category: 'Operating Revenue', detailType: 'Sales', isSystem: false },
  { accountNumber: '4020', accountCode: 'REVENUE_ELECTRICITY', name: 'Electricity Revenue', type: 'Revenue', category: 'Operating Revenue', detailType: 'Sales', isSystem: false },
  { accountNumber: '4030', accountCode: 'REVENUE_RENT', name: 'Rent Revenue', type: 'Revenue', category: 'Operating Revenue', detailType: 'Sales', isSystem: false },
  { accountNumber: '5000', accountCode: 'COGS', name: 'Cost of Goods Sold', type: 'Expense', category: 'Cost of Sales', detailType: 'Cost of Goods Sold', isSystem: true },
  { accountNumber: '5001', accountCode: 'EXPENSE_GENERAL', name: 'General Expenses', type: 'Expense', category: 'Operating Expense', detailType: 'Other Operating Expenses', isSystem: true },
  { accountNumber: '5002', accountCode: 'EXPENSE_SALARIES', name: 'Salaries Expense', type: 'Expense', category: 'Operating Expense', detailType: 'Payroll Expenses', isSystem: true },
  { accountNumber: '5015', accountCode: 'EOBI_EXPENSE', name: 'EOBI Expense', type: 'Expense', category: 'Operating Expense', detailType: 'Payroll Expenses', isSystem: true },
  { accountNumber: '5003', accountCode: 'DEPRECIATION', name: 'Depreciation Expense', type: 'Expense', category: 'Operating Expense', detailType: 'Depreciation', isSystem: false },
  { accountNumber: '6200', accountCode: 'UTILITIES', name: 'Utilities (Electricity/Gas)', type: 'Expense', category: 'Operating Expense', detailType: 'Other Operating Expenses', isSystem: true }
];

const seedChartOfAccountsForCompany = async (companyId, { createdBy = null, skipExisting = true } = {}) => {
  const results = [];

  for (const template of STANDARD_SYSTEM_ACCOUNTS) {
    const existing = await Account.findOne({
      companyId,
      accountNumber: template.accountNumber
    }).select('_id accountNumber name').lean();

    if (existing && skipExisting) {
      results.push({ status: 'exists', accountNumber: template.accountNumber, name: existing.name, _id: existing._id });
      continue;
    }

    if (existing && !skipExisting) {
      await Account.updateOne(
        { _id: existing._id },
        {
          $set: {
            accountCode: template.accountCode,
            isSystem: template.isSystem,
            isActive: true
          }
        }
      );
      results.push({ status: 'updated', accountNumber: template.accountNumber, name: template.name, _id: existing._id });
      continue;
    }

    try {
      const created = await Account.create({
        companyId,
        accountNumber: template.accountNumber,
        accountCode: template.accountCode,
        name: template.name,
        type: template.type,
        category: template.category,
        detailType: template.detailType,
        description: template.name,
        isActive: true,
        isSystem: template.isSystem,
        balance: 0,
        metadata: createdBy ? { createdBy } : undefined
      });
      results.push({ status: 'created', accountNumber: template.accountNumber, name: template.name, _id: created._id });
    } catch (err) {
      if (err.code === 11000) {
        const existing = await Account.findOne({
          companyId,
          accountNumber: template.accountNumber
        }).select('_id name').lean();
        results.push({
          status: 'exists',
          accountNumber: template.accountNumber,
          name: existing?.name || template.name,
          _id: existing?._id
        });
      } else {
        throw err;
      }
    }
  }

  const { ensureEobiPayableAccounts } = require('./eobiPayableAccount');
  await ensureEobiPayableAccounts(companyId, createdBy);

  return {
    created: results.filter((row) => row.status === 'created').length,
    updated: results.filter((row) => row.status === 'updated').length,
    existing: results.filter((row) => row.status === 'exists').length,
    results
  };
};

const assignHistoricalAccountsToCompany = async (companyId) => {
  const accountCodeByNumber = new Map(
    STANDARD_SYSTEM_ACCOUNTS.map((row) => [row.accountNumber, row.accountCode])
  );

  const accounts = await Account.find({
    $or: [{ companyId: null }, { companyId: { $exists: false } }]
  }).select('_id accountNumber').lean();

  let modified = 0;
  for (const account of accounts) {
    const accountCode = accountCodeByNumber.get(String(account.accountNumber)) || undefined;
    await Account.updateOne(
      { _id: account._id },
      {
        $set: {
          companyId,
          ...(accountCode ? { accountCode } : {})
        }
      }
    );
    modified += 1;
  }

  return { modified, totalUnassigned: accounts.length };
};

/**
 * The company's account for a system role (e.g. '2001' Accounts Payable, '6200' Utilities). When the chart has no
 * fitting account, the standard one is added — under its standard number, or the next free number when that number
 * is already used by a different account — so automatic postings never stop on a missing system account.
 */
const ensureSystemAccount = async (companyId, accountNumber, { createdBy = null } = {}) => {
  const { resolveSystemAccount } = require('./accountResolver');
  const found = await resolveSystemAccount(companyId, accountNumber);
  if (found || !companyId) return found;

  const template = STANDARD_SYSTEM_ACCOUNTS.find((t) => t.accountNumber === String(accountNumber));
  if (!template) return null;

  // Standard number already taken by another account → 2001-1, 2001-2 …
  let number = template.accountNumber;
  for (let i = 1; await Account.exists({ companyId, accountNumber: number }); i++) {
    number = `${template.accountNumber}-${i}`;
  }
  try {
    await Account.create({
      companyId,
      accountNumber: number,
      accountCode: template.accountCode,
      name: template.name,
      type: template.type,
      category: template.category,
      detailType: template.detailType,
      description: `${template.name} (added automatically — required for automatic postings)`,
      isActive: true,
      isSystem: template.isSystem,
      balance: 0,
      metadata: createdBy ? { createdBy } : undefined
    });
    console.warn(`[chart] Added ${number} ${template.name} to company ${companyId} — it had no ${template.accountCode} account`);
  } catch (err) {
    if (err.code !== 11000) throw err;
  }
  return resolveSystemAccount(companyId, accountNumber);
};

module.exports = {
  STANDARD_SYSTEM_ACCOUNTS,
  seedChartOfAccountsForCompany,
  assignHistoricalAccountsToCompany,
  ensureSystemAccount
};
