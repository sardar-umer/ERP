const mongoose = require('mongoose');
const Account = require('../models/finance/Account');

const ACCOUNT_NUMBER_TO_CODE = {
  '1001': 'CASH',
  '1002': 'BANK',
  '1100': 'RECEIVABLE',
  '1110': 'VENDOR_ADVANCE',
  '1120': 'STAFF_ADVANCE',
  '1125': 'EMPLOYEE_LOAN',
  '1200': 'INVENTORY',
  '2001': 'PAYABLE',
  '2004': 'WHT_PAYABLE',
  '2100': 'GRNI',
  '2140': 'GRNI_ALT',
  '2200': 'SALARIES_PAYABLE',
  '2210': 'PF_PAYABLE',
  '2211': 'EOBI_PAYABLE',
  '2211-01': 'EOBI_PAYABLE_EMP',
  '2211-02': 'EOBI_PAYABLE_ER',
  '2212': 'OTHER_PAYROLL_DED',
  '4010': 'REVENUE_CAM',
  '4020': 'REVENUE_ELECTRICITY',
  '4030': 'REVENUE_RENT',
  '5000': 'COGS',
  '5001': 'EXPENSE_GENERAL',
  '5002': 'EXPENSE_SALARIES',
  '6200': 'UTILITIES'
};

const normalizeCompanyObjectId = async (companyId) => {
  if (!companyId) {
    // Do NOT silently fall back to Sardar — callers must pass a real company when scoped.
    return null;
  }
  if (mongoose.Types.ObjectId.isValid(String(companyId))) {
    return new mongoose.Types.ObjectId(String(companyId));
  }
  return null;
};

const getAccountByNumber = async (companyId, accountNumber) => {
  const cid = await normalizeCompanyObjectId(companyId);
  const number = String(accountNumber || '').trim();
  if (!number) return null;

  if (cid) {
    const scoped = await Account.findOne({ companyId: cid, accountNumber: number, isActive: true });
    if (scoped) return scoped;
  }

  return Account.findOne({ 
    accountNumber: number, 
    isActive: true, 
    $or: [{ companyId: null }, { companyId: { $exists: false } }] 
  });
};

const getAccountByCode = async (companyId, accountCode) => {
  const cid = await normalizeCompanyObjectId(companyId);
  const code = String(accountCode || '').trim().toUpperCase();
  if (!code) return null;
  
  if (cid) {
    const scoped = await Account.findOne({ companyId: cid, accountCode: code, isActive: true });
    if (scoped) return scoped;
  }
  
  return Account.findOne({ 
    accountCode: code, 
    isActive: true, 
    $or: [{ companyId: null }, { companyId: { $exists: false } }] 
  });
};

/**
 * What each system account must look like. Account numbers are per company and do not always mean the same thing
 * (e.g. 1110 is "Security Deposits" in one chart), so a number match is only trusted when type + name fit;
 * otherwise the company's correctly named account is used, and if there is none the caller gets null (no silent
 * posting to a wrong account). `check` validates a number match; `find` locates the right account by name.
 */
const SYSTEM_ACCOUNT_RULES = {
  CASH: { type: 'Asset', check: /cash|petty/i, find: /^cash|cash in hand|petty cash/i },
  BANK: { type: 'Asset', check: /bank/i, find: /bank/i },
  RECEIVABLE: { type: 'Asset', check: /receivable|debtor/i, find: /accounts? receivable|trade debtors?/i },
  VENDOR_ADVANCE: { type: 'Asset', check: /advance|prepay/i, find: /advances? to (suppliers?|vendors?|contractors?)|supplier advance|vendor advance/i },
  STAFF_ADVANCE: { type: 'Asset', check: /advance|staff|imprest/i, find: /(staff|employee|cash) advance|advances? to (staff|employees)/i },
  EMPLOYEE_LOAN: { type: 'Asset', check: /loan|advance/i, find: /employee loan|staff loan|loans? to employees/i },
  INVENTORY: { type: 'Asset', check: /inventory|stock/i, find: /inventory|stock valuation|stock in hand/i },
  PAYABLE: { type: 'Liability', check: /payable|creditor/i, find: /^accounts? payables?\b|^trade (creditors?|payables?)|^sundry creditors?|^creditors?( control)?$/i },
  WHT_PAYABLE: { type: 'Liability', check: /wht|withholding|tax/i, find: /wht|withholding/i },
  GRNI: { type: 'Liability', check: /received|grni|accrued/i, find: /goods received not invoiced|\bgrni\b/i },
  GRNI_ALT: { type: 'Liability', check: /received|grni|accrued/i, find: /goods received not invoiced|\bgrni\b/i },
  SALARIES_PAYABLE: { type: 'Liability', check: /salar|wage|payroll/i, find: /salar(y|ies) payable|wages payable|payroll payable/i },
  REVENUE_CAM: { type: 'Revenue', check: /cam|maintenance/i, find: /cam revenue|maintenance (charges|revenue)/i },
  REVENUE_ELECTRICITY: { type: 'Revenue', check: /electric/i, find: /electricity revenue/i },
  REVENUE_RENT: { type: 'Revenue', check: /rent/i, find: /rent(al)? (revenue|income)/i },
  COGS: { type: 'Expense', check: /cost of|cogs|goods sold/i, find: /cost of (goods|sales)|cogs/i },
  EXPENSE_GENERAL: { type: 'Expense', check: /.*/, find: /general expense/i },
  EXPENSE_SALARIES: { type: 'Expense', check: /salar|wage/i, find: /salar(y|ies) expense|wages expense/i },
  UTILITIES: { type: 'Expense', check: /utilit|electric/i, find: /utilit|electricity (and|&) gas|electricity expense/i }
};

const fitsRule = (account, rule) => !rule || (account && account.type === rule.type && rule.check.test(account.name || ''));

const findByRule = async (companyId, rule) => {
  const cid = await normalizeCompanyObjectId(companyId);
  if (!cid || !rule) return null;
  return Account.findOne({ companyId: cid, isActive: true, type: rule.type, name: rule.find }).sort({ accountNumber: 1 });
};

const resolveSystemAccount = async (companyId, accountNumber) => {
  const number = String(accountNumber || '').trim();
  if (!number) return null;

  const code = ACCOUNT_NUMBER_TO_CODE[number];
  const rule = code ? SYSTEM_ACCOUNT_RULES[code] : null;
  if (code) {
    // Codes were stamped on some charts by number, so a code match is checked too; with several accounts
    // carrying the same code, the one whose type + name fit wins
    const cid = await normalizeCompanyObjectId(companyId);
    const coded = cid
      ? await Account.find({ companyId: cid, accountCode: code, isActive: true }).sort({ accountNumber: 1 })
      : [];
    const fit = coded.find((a) => fitsRule(a, rule));
    if (fit) return fit;
    if (!cid) {
      const globalByCode = await getAccountByCode(null, code);
      if (fitsRule(globalByCode, rule)) return globalByCode;
    }
  }
  const byNumber = await getAccountByNumber(companyId, number);
  if (fitsRule(byNumber, rule)) return byNumber;

  // The number means something else in this company's chart: use its correctly named account instead
  const byName = await findByRule(companyId, rule);
  if (byName) return byName;
  if (byNumber) {
    console.warn(`[accountResolver] ${number} in company ${companyId} is "${byNumber.name}" (${byNumber.type}) — not a ${code} account; nothing posted to it`);
  }
  return null;
};

const mapAccountToCompany = async (companyId, accountDocOrId) => {
  const cid = await normalizeCompanyObjectId(companyId);
  
  let account = accountDocOrId;
  if (!account) return null;
  if (mongoose.Types.ObjectId.isValid(String(account))) {
    account = await Account.findById(account).lean();
  }
  if (!account?._id) return null;

  if (cid && account.companyId && String(account.companyId) === String(cid)) {
    return account;
  }

  if (account.accountCode) {
    const byCode = await getAccountByCode(cid, account.accountCode);
    if (byCode) return byCode;
  }

  if (account.accountNumber) {
    const byNumber = await getAccountByNumber(cid, account.accountNumber);
    if (byNumber) return byNumber;
  }

  // Fallback: If it's a global account, it can be used across companies
  if (!account.companyId) {
    return account;
  }

  return null;
};

module.exports = {
  ACCOUNT_NUMBER_TO_CODE,
  normalizeCompanyObjectId,
  getAccountByNumber,
  getAccountByCode,
  resolveSystemAccount,
  mapAccountToCompany,
  SYSTEM_ACCOUNT_RULES
};
