/**
 * Full E2E: Inventory (qty 0 + explicit Chart of Accounts) → Indent → procurement → GRN → SIN
 * with finance validation and a printed checklist for manual UI verification.
 *
 * Run:
 *   node tests/full-indent-inventory-grn-sin-finance-e2e.test.js
 *   npm run test:full-indent-grn-sin-finance
 *
 * Requires:
 *   - API: E2E_API_URL (default http://localhost:5001/api)
 *   - ceo@sgc.com / ceo12345
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const axios = require('axios');
const { pickGrnBillApprover, approveGrnBillAsAuthority } = require('./helpers/grnBillApproval');

const BASE = process.env.E2E_API_URL || 'http://localhost:5001/api';

/** Standard posting accounts (must exist or be created by ensure-defaults) */
const GL = {
  INVENTORY: '1100',
  GRNI: '2100',
  COGS: '5000',
  AP: '2001',
  CASH: '1001',
  BANK: '1002'
};

const state = {
  userId: null,
  accounts: { inventory: null, grni: null, cogs: null },
  indent: null,
  quotation: null,
  po: null,
  grn: null,
  sin: null,
  inventory: null,
  project: null
};

const results = { pass: 0, fail: 0 };
const checklist = [];

function log(ok, msg, extra) {
  const icon = ok ? '✓' : '✗';
  console.log(`${icon} ${msg}`, extra !== undefined ? extra : '');
  if (ok) results.pass += 1;
  else results.fail += 1;
}

function die(msg, extra) {
  log(false, msg, extra);
  printFinanceReport(false);
  process.exit(1);
}

function entryBalances(entry) {
  const lines = entry?.lines || [];
  let dr = 0;
  let cr = 0;
  for (const l of lines) {
    dr += Number(l.debit) || 0;
    cr += Number(l.credit) || 0;
  }
  return { dr, cr, ok: Math.abs(dr - cr) < 0.02 };
}

async function fetchJournals(api, search) {
  const res = await api.get('/finance/journal-entries', {
    params: { limit: 40, search, module: 'procurement' }
  });
  if (res.status !== 200 || !res.data?.success) return [];
  return res.data?.data?.entries || [];
}

function lineAccountNumber(line) {
  const a = line?.account;
  if (!a) return '';
  if (typeof a === 'object' && a.accountNumber) return String(a.accountNumber);
  return '';
}

/**
 * GRN posting: DR Inventory (1100), CR GRNI (2100)
 */
function journalsMatchGrnPattern(entries, expectedDr, expectedCr) {
  if (!entries.length) return { ok: false, reason: 'no entries' };
  for (const e of entries) {
    const lines = e.lines || [];
    let hasDr = false;
    let hasCr = false;
    for (const l of lines) {
      const num = lineAccountNumber(l);
      if (Number(l.debit) > 0 && num === expectedDr) hasDr = true;
      if (Number(l.credit) > 0 && num === expectedCr) hasCr = true;
    }
    if (hasDr && hasCr) return { ok: true };
  }
  return { ok: false, reason: `expected DR ${expectedDr} / CR ${expectedCr} lines` };
}

/**
 * SIN / COGS posting: DR COGS (5000), CR Inventory (1100)
 */
function journalsMatchSinPattern(entries, expectedDr, expectedCr) {
  if (!entries.length) return { ok: false, reason: 'no entries' };
  for (const e of entries) {
    const lines = e.lines || [];
    let hasDr = false;
    let hasCr = false;
    for (const l of lines) {
      const num = lineAccountNumber(l);
      if (Number(l.debit) > 0 && num === expectedDr) hasDr = true;
      if (Number(l.credit) > 0 && num === expectedCr) hasCr = true;
    }
    if (hasDr && hasCr) return { ok: true };
  }
  return { ok: false, reason: `expected DR ${expectedDr} / CR ${expectedCr} lines` };
}

/**
 * API checks: Trial Balance v2, Balance Sheet, General Ledger (same rules as Finance UI).
 */
async function verifyFinanceReports(api, asOfDate, grnRef, sinRef) {
  const out = { trialBalanceOk: false, balanceSheetOk: false, generalLedgerOk: false, details: {} };

  const tbRes = await api.get('/finance/reports/trial-balance-v2', { params: { asOfDate } });
  if (tbRes.status !== 200 || !tbRes.data?.success) {
    log(false, 'Trial Balance v2 API failed', tbRes.status);
    out.details.trialBalance = tbRes.data;
    return out;
  }
  const tb = tbRes.data.data;
  out.details.trialBalance = {
    isBalanced: tb.totals?.isBalanced,
    totalDebits: tb.totals?.totalDebits,
    totalCredits: tb.totals?.totalCredits
  };
  out.trialBalanceOk = tb.totals?.isBalanced === true && (tb.rows?.length || 0) > 0;
  log(out.trialBalanceOk, 'Trial Balance v2: debits = credits & has rows', out.details.trialBalance);

  const bsRes = await api.get('/finance/reports/balance-sheet', { params: { asOfDate } });
  if (bsRes.status !== 200 || !bsRes.data?.success) {
    log(false, 'Balance Sheet API failed', bsRes.status);
    out.details.balanceSheet = bsRes.data;
    return out;
  }
  const bs = bsRes.data.data;
  out.details.balanceSheet = {
    isBalanced: bs.totals?.isBalanced,
    totalAssets: bs.totals?.totalAssets,
    liabilitiesEquityAndPL: bs.totals?.liabilitiesEquityAndPL,
    netIncome: bs.pAndL?.netIncome
  };
  out.balanceSheetOk = bs.totals?.isBalanced === true;
  log(out.balanceSheetOk, 'Balance Sheet: Assets = Liab + Equity + net P&L', out.details.balanceSheet);

  const grnNorm = String(grnRef || '').trim();
  const sinNorm = String(sinRef || '').trim();
  const [glGrn, glSin] = await Promise.all([
    api.get('/finance/general-ledger', { params: { limit: 10, module: 'procurement', search: grnNorm } }),
    api.get('/finance/general-ledger', { params: { limit: 10, module: 'procurement', search: sinNorm } })
  ]);
  if (glGrn.status !== 200 || !glGrn.data?.success || glSin.status !== 200 || !glSin.data?.success) {
    log(false, 'General Ledger API failed', { grn: glGrn.status, sin: glSin.status });
    out.details.generalLedger = { grn: glGrn.data, sin: glSin.data };
    return out;
  }
  const grnCount = glGrn.data?.data?.pagination?.totalCount ?? (glGrn.data?.data?.entries || []).length;
  const sinCount = glSin.data?.data?.pagination?.totalCount ?? (glSin.data?.data?.entries || []).length;
  out.details.generalLedger = { grnLineHits: grnCount, sinLineHits: sinCount };
  out.generalLedgerOk = grnCount > 0 && sinCount > 0;
  log(out.generalLedgerOk, 'General Ledger: procurement GL has GRN + SIN search hits', out.details.generalLedger);

  return out;
}

async function verifyProfitLoss(api, fromDate, toDate) {
  const out = { ok: false, details: {} };
  const plRes = await api.get('/finance/reports/profit-loss', { params: { fromDate, toDate } });
  if (plRes.status !== 200 || !plRes.data?.success) {
    log(false, 'Profit & Loss API failed', plRes.status);
    out.details = plRes.data;
    return out;
  }
  const pl = plRes.data.data || {};
  const expenseRows = pl.expenses?.rows || [];
  const revenueRows = pl.revenue?.rows || [];
  out.details = {
    totalRevenue: pl.totals?.totalRevenue || 0,
    totalExpenses: pl.totals?.totalExpenses || 0,
    netProfit: pl.totals?.netProfit || 0
  };
  out.ok = expenseRows.length > 0 || revenueRows.length > 0;
  log(out.ok, 'Profit & Loss returns non-empty report rows', out.details);
  return out;
}

function printFinanceReport(allAutomatedPassed) {
  console.log('\n========== FINANCE VERIFICATION REPORT ==========');
  console.log('Automated checks this run:', {
    passed: results.pass,
    failed: results.fail,
    overall: allAutomatedPassed ? 'PASS' : 'FAIL'
  });
  console.log('\nArtifacts for manual follow-up in Finance module:');
  console.log('  • Journal entries (Finance → Journal Entries), filter module: Procurement');
  console.log('    – Search by GRN:', state.grn?.receiveNumber || '—');
  console.log('    – Search by SIN:', state.sin?.issueNumber || state.sin?.sinNumber || '—');
  console.log('  • Expected GRN posting: DR', GL.INVENTORY, '(Inventory) / CR', GL.GRNI, '(GRNI)');
  console.log('  • Expected SIN posting:  DR', GL.COGS, '(COGS) / CR', GL.INVENTORY, '(Inventory)');
  console.log('  • General Ledger: lines should mirror posted journals for same references.');
  console.log('  • Inventory item:', state.inventory?.itemCode, '— WAC should update after GRN; qty reduces after SIN.');
  console.log('  • Stock (Store): project balance should drop by SIN qty after issue.');
  console.log('\nChecklist (what should be OK if everything is correct):');
  for (const row of checklist) {
    console.log(`  [${row.ok ? 'OK' : 'CHECK'}] ${row.label}${row.detail ? ` — ${row.detail}` : ''}`);
  }
  console.log('==================================================\n');
}

async function main() {
  const api = axios.create({
    baseURL: BASE,
    headers: { 'Content-Type': 'application/json' },
    timeout: 120000,
    validateStatus: () => true
  });

  const loginRes = await api.post('/auth/login', {
    email: 'ceo@sgc.com',
    password: 'ceo12345'
  });
  if (loginRes.status !== 200 || !loginRes.data?.success || !loginRes.data?.data?.token) {
    die('Login failed', loginRes.data);
  }
  api.defaults.headers.Authorization = `Bearer ${loginRes.data.data.token}`;
  state.userId = loginRes.data.data.user?._id || loginRes.data.data.user?.id;
  log(true, 'Login OK (ceo@sgc.com)');

  const ensureRes = await api.post('/finance/accounts/ensure-defaults');
  if (ensureRes.status !== 200 || !ensureRes.data?.success) {
    die('ensure-defaults failed (need Chart of Accounts access)', ensureRes.data);
  }
  const accRows = Array.isArray(ensureRes.data.data) ? ensureRes.data.data : [];
  const byNum = (n) => accRows.find((a) => a.accountNumber === n);
  const invA = byNum(GL.INVENTORY);
  const grniA = byNum(GL.GRNI);
  const cogsA = byNum(GL.COGS);
  if (!invA?._id || !grniA?._id || !cogsA?._id) {
    die('Missing GL accounts 1100 / 2100 / 5000 after ensure-defaults', { invA, grniA, cogsA });
  }
  state.accounts = {
    inventory: invA._id,
    grni: grniA._id,
    cogs: cogsA._id
  };
  log(true, 'Chart of Accounts linked for test', {
    inventory: `${GL.INVENTORY} ${invA.name}`,
    grni: `${GL.GRNI} ${grniA.name}`,
    cogs: `${GL.COGS} ${cogsA.name}`
  });

  const stamp = Date.now();
  const sinQty = 10;
  const grnQty = 100;
  const today = new Date().toISOString().split('T')[0];
  const nextMonth = new Date(Date.now() + 30 * 864e5).toISOString().split('T')[0];

  const deptRes = await api.get('/indents/departments');
  const departments = Array.isArray(deptRes.data?.data) ? deptRes.data.data : [];
  const department = departments[0];
  if (!department?._id) die('No department for indent', deptRes.data);

  const vendorRes = await api.get('/procurement/vendors', { params: { limit: 20 } });
  const vendors = vendorRes.data?.data?.vendors || [];
  const vendor = vendors[0];
  if (!vendor?._id) die('No vendor found', vendorRes.data);

  const projectRes = await api.get('/hr/projects', { params: { limit: 20, status: 'Active' } });
  const projects = projectRes.data?.data?.projects || projectRes.data?.data || [];
  const project = Array.isArray(projects) ? projects[0] : null;
  if (!project?._id) die('No active project', projectRes.data);
  state.project = project;

  const storesRes = await api.get('/stores', { params: { activeOnly: 'true' } });
  const storeList = storesRes.data?.data || [];
  const mainStore = Array.isArray(storeList) ? storeList[0] : null;
  if (!mainStore?._id) die('No active store', storesRes.data);
  log(true, `Store: ${mainStore.name || mainStore._id}`);

  const invCatRes = await api.get('/inventory-categories');
  const invCategories = Array.isArray(invCatRes.data?.data) ? invCatRes.data.data : [];
  const invCategory = invCategories[0] || null;

  const itemName = `E2E Full Flow Item ${stamp}`;
  const itemCode = `E2E-FULL-${stamp}`;
  const invCreate = await api.post('/procurement/inventory', {
    name: itemName,
    itemCode,
    category: 'Raw Materials',
    unit: 'bag',
    quantity: 0,
    unitPrice: 850,
    minQuantity: 0,
    maxQuantity: 100000,
    description: 'Full E2E — explicit GL accounts',
    ...(invCategory ? { inventoryCategory: invCategory._id } : {})
  });
  if (invCreate.status !== 201 || !invCreate.data?.success) die('Inventory create failed', invCreate.data);
  state.inventory = invCreate.data.data;

  const invUpdate = await api.put(`/procurement/inventory/${state.inventory._id}`, {
    inventoryAccount: state.accounts.inventory,
    grniAccount: state.accounts.grni,
    cogsAccount: state.accounts.cogs
  });
  if (invUpdate.status !== 200 || !invUpdate.data?.success) {
    die('Inventory GL account attach failed', invUpdate.data);
  }
  state.inventory = invUpdate.data.data || state.inventory;
  log(true, 'Inventory qty=0 + DR/CR accounts set on item', { itemCode });

  const indentPayload = {
    title: `E2E Full Finance ${stamp}`,
    description: 'Full indent to SIN',
    department: department._id,
    requiredDate: nextMonth,
    justification: 'E2E full test',
    priority: 'High',
    category: 'Raw Materials',
    items: [
      {
        itemName,
        description: itemName,
        brand: 'Lucky',
        quantity: grnQty,
        unit: 'bag',
        purpose: 'Site',
        estimatedCost: 850
      }
    ]
  };
  const indentCreate = await api.post('/indents', indentPayload);
  if (indentCreate.status !== 201 || !indentCreate.data?.success) die('Indent failed', indentCreate.data);
  state.indent = indentCreate.data.data;

  await api.post(`/indents/${state.indent._id}/submit`);
  await api.post(`/indents/${state.indent._id}/approve`);
  const moveIndent = await api.post(`/indents/${state.indent._id}/move-to-procurement`, { reason: 'No stock' });
  if (moveIndent.status !== 200 || !moveIndent.data?.success) die('Move to procurement failed', moveIndent.data);

  const quotationPayload = {
    indent: state.indent._id,
    vendor: vendor._id,
    quotationDate: today,
    expiryDate: nextMonth,
    status: 'Received',
    validityDays: 30,
    deliveryTime: '7 days',
    paymentTerms: 'Partial advance 20%',
    notes: 'E2E',
    items: [
      {
        description: itemName,
        quantity: grnQty,
        unit: 'bag',
        unitPrice: 840,
        taxRate: 0,
        discount: 0
      }
    ]
  };
  const quoteCreate = await api.post('/procurement/quotations', quotationPayload);
  if (quoteCreate.status !== 201 || !quoteCreate.data?.success) die('Quotation failed', quoteCreate.data);
  state.quotation = quoteCreate.data.data;
  await api.put(`/procurement/quotations/${state.quotation._id}`, { status: 'Finalized' });

  const poCreate = await api.post(`/procurement/quotations/${state.quotation._id}/create-po`);
  if (poCreate.status !== 201 || !poCreate.data?.success) die('PO failed', poCreate.data);
  state.po = poCreate.data.data;

  await api.put(`/procurement/purchase-orders/${state.po._id}/send-to-audit`, {});
  await api.put(`/procurement/purchase-orders/${state.po._id}/audit-approve`, { approvalComments: 'E2E' });
  await api.put(`/procurement/purchase-orders/${state.po._id}/forward-to-ceo`, { comments: 'E2E' });
  const ceoApprove = await api.put(`/procurement/purchase-orders/${state.po._id}/ceo-approve`, {
    approvalComments: 'E2E',
    digitalSignature: 'CEO-E2E'
  });
  if (ceoApprove.status !== 200 || !ceoApprove.data?.success) die('CEO approve failed', ceoApprove.data);
  if (ceoApprove.data?.sentToFinance) {
    await api.put(`/procurement/purchase-orders/${state.po._id}/finance-approve`, { approvalComments: 'E2E finance' });
  }

  await api.put(`/procurement/purchase-orders/${state.po._id}/send-to-store`, { comments: 'E2E' });

  const grnCreate = await api.post('/procurement/goods-receive', {
    receiveDate: today,
    project: project._id,
    store: mainStore._id,
    supplier: vendor._id,
    supplierName: vendor.name,
    purchaseOrder: state.po._id,
    poNumber: state.po.orderNumber,
    status: 'Complete',
    notes: 'E2E full GRN',
    items: [
      {
        inventoryItem: state.inventory._id,
        quantity: grnQty,
        unitPrice: 840,
        itemName,
        itemCode: state.inventory.itemCode,
        unit: 'bag'
      }
    ]
  });
  if (grnCreate.status !== 201 || !grnCreate.data?.success) die('GRN failed', grnCreate.data);
  state.grn = grnCreate.data.data;
  log(true, `GRN: ${state.grn.receiveNumber}`);

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let projectBalance = 0;
  for (let i = 0; i < 40; i += 1) {
    const balRes = await api.get('/procurement/stock-balance', {
      params: { project: project._id, item: state.inventory._id, storeId: mainStore._id }
    });
    projectBalance = Number(balRes.data?.data?.balance) || 0;
    if (projectBalance >= sinQty) break;
    await sleep(250);
  }
  if (projectBalance < sinQty) die(`Stock not ready (need ≥${sinQty}, got ${projectBalance})`);
  log(true, `Project stock OK: ${projectBalance}`);

  const grnEntries = await fetchJournals(api, state.grn.receiveNumber || '');
  let grnBalanced = true;
  for (const e of grnEntries) {
    const b = entryBalances(e);
    if (!b.ok) grnBalanced = false;
  }
  const grnPattern = journalsMatchGrnPattern(grnEntries, GL.INVENTORY, GL.GRNI);
  checklist.push({
    label: 'GRN journal: debits = credits',
    ok: grnEntries.length > 0 && grnBalanced,
    detail: grnEntries.length ? `${grnEntries.length} entry/entries` : 'none found'
  });
  checklist.push({
    label: 'GRN journal: DR Inventory (1100) / CR GRNI (2100)',
    ok: grnPattern.ok,
    detail: grnPattern.reason || 'pattern matched'
  });
  log(grnEntries.length > 0 && grnBalanced, 'GRN journals balanced');
  log(grnPattern.ok, 'GRN journal lines match Inventory/GRNI accounts');

  // Procurement bill creation (new flow): create AP bill from selected GRN(s), not from PO approval.
  const billApprover = await pickGrnBillApprover(api);
  const billCreate = await api.post('/procurement/vendor-bills', {
    vendorId: vendor._id,
    grnIds: [state.grn._id],
    billDate: today,
    paymentTerms: 'net_30',
    vendorInvoiceNumber: `VINV-${Date.now()}`,
    approvalAuthorityId: billApprover._id
  });
  if (billCreate.status !== 201 || !billCreate.data?.success) die('Procurement vendor bill creation failed', billCreate.data);
  // Procurement approval authority approves → bill moves to 'Pending Audit' (as before this step existed)
  await approveGrnBillAsAuthority(BASE, billApprover, billCreate.data.data._id);
  log(true, `Vendor bill approved by approval authority (${billApprover.name})`);

  const sinRes = await api.post('/procurement/goods-issue', {
    issueDate: new Date().toISOString(),
    project: project._id,
    store: mainStore._id,
    issuingLocation: mainStore.name || 'Main Store',
    department: 'procurement',
    departmentName: 'Procurement',
    purpose: 'E2E issue',
    notes: 'E2E SIN',
    requestedBy: state.userId,
    requestedByName: 'E2E',
    items: [
      {
        inventoryItem: state.inventory._id,
        qtyIssued: sinQty,
        quantity: sinQty,
        itemName,
        itemCode: state.inventory.itemCode,
        unit: 'bag'
      }
    ]
  });
  if (sinRes.status !== 201 || !sinRes.data?.success) die('SIN failed', sinRes.data);
  state.sin = sinRes.data.data;
  log(true, `SIN: ${state.sin.issueNumber || state.sin.sinNumber}`);

  const sinRef = state.sin.issueNumber || state.sin.sinNumber || '';
  const sinEntries = await fetchJournals(api, sinRef);
  let sinBalanced = true;
  for (const e of sinEntries) {
    const b = entryBalances(e);
    if (!b.ok) sinBalanced = false;
  }
  const sinPattern = journalsMatchSinPattern(sinEntries, GL.COGS, GL.INVENTORY);
  checklist.push({
    label: 'SIN journal: debits = credits',
    ok: sinEntries.length > 0 && sinBalanced,
    detail: sinEntries.length ? `${sinEntries.length} entry/entries` : 'none found'
  });
  checklist.push({
    label: 'SIN journal: DR COGS (5000) / CR Inventory (1100)',
    ok: sinPattern.ok,
    detail: sinPattern.reason || 'pattern matched'
  });
  log(sinEntries.length > 0 && sinBalanced, 'SIN journals balanced');
  log(sinPattern.ok, 'SIN journal lines match COGS/Inventory accounts');

  const sinCogsJournals = sinEntries.filter((e) => {
    if (!entryBalances(e).ok) return false;
    return journalsMatchSinPattern([e], GL.COGS, GL.INVENTORY).ok;
  });
  checklist.push({
    label: 'SIN: exactly one COGS/Inventory journal (no duplicate postCOGS + postSIN)',
    ok: sinCogsJournals.length === 1,
    detail: `matching entries=${sinCogsJournals.length}`
  });
  log(sinCogsJournals.length === 1, `SIN COGS journal count (expect 1): ${sinCogsJournals.length}`);

  // AP payment: settle vendor bill created from procurement GRN billing.
  const apList = await api.get('/finance/accounts-payable', { params: { limit: 50, search: vendor.name } });
  const apBills = apList.data?.data?.bills || [];
  const apBill = apBills.find((b) =>
    Array.isArray(b.linkedGRNs) && b.linkedGRNs.some((g) => String(g.grnId || '') === String(state.grn._id))
  ) || apBills[0];
  if (!apBill?._id) die('AP bill not found for PO', { po: state.po.orderNumber, apList: apList.data });

  const outstanding = Math.round(((Number(apBill.totalAmount) || 0) - (Number(apBill.amountPaid) || 0)) * 100) / 100;
  if (outstanding <= 0) die('AP outstanding is not positive', { billNumber: apBill.billNumber, outstanding });
  const paymentRef = `E2E-APPAY-${stamp}`;
  const payRes = await api.post(`/finance/accounts-payable/${apBill._id}/payment`, {
    amount: outstanding,
    paymentMethod: 'cash',
    reference: paymentRef,
    paymentDate: new Date().toISOString()
  });
  if (payRes.status !== 200 || !payRes.data?.success) die('AP payment failed', payRes.data);
  const apAfter = payRes.data.data;
  const apRemaining = Math.round(((Number(apAfter.totalAmount) || 0) - (Number(apAfter.amountPaid) || 0)) * 100) / 100;
  checklist.push({
    label: 'AP bill paid: outstanding reduced to zero',
    ok: Math.abs(apRemaining) < 0.02,
    detail: `bill=${apAfter.billNumber}, remaining=${apRemaining}`
  });
  log(Math.abs(apRemaining) < 0.02, `AP payment posted (${paymentRef})`);

  const payJournals = await fetchJournals(api, paymentRef);
  let payBalanced = true;
  for (const e of payJournals) {
    if (!entryBalances(e).ok) payBalanced = false;
  }
  let apDebit = false;
  let cashOrBankCredit = false;
  for (const e of payJournals) {
    for (const l of e.lines || []) {
      const num = lineAccountNumber(l);
      if (Number(l.debit) > 0 && num === GL.AP) apDebit = true;
      if (Number(l.credit) > 0 && (num === GL.CASH || num === GL.BANK)) cashOrBankCredit = true;
    }
  }
  checklist.push({
    label: 'AP payment journal: DR AP (2001) / CR Cash-or-Bank (1001/1002)',
    ok: payJournals.length > 0 && payBalanced && apDebit && cashOrBankCredit,
    detail: `entries=${payJournals.length}, apDebit=${apDebit}, cashOrBankCredit=${cashOrBankCredit}`
  });
  log(payJournals.length > 0 && payBalanced && apDebit && cashOrBankCredit, 'AP payment journal lines match AP/Cash-Bank');

  const asOfVerify = new Date().toISOString().split('T')[0];
  const reportCheck = await verifyFinanceReports(api, asOfVerify, state.grn.receiveNumber || '', sinRef);
  checklist.push({
    label: 'Trial Balance v2: balanced & non-empty',
    ok: reportCheck.trialBalanceOk,
    detail: JSON.stringify(reportCheck.details.trialBalance || {})
  });
  checklist.push({
    label: 'Balance Sheet: balanced (incl. net P&L)',
    ok: reportCheck.balanceSheetOk,
    detail: JSON.stringify(reportCheck.details.balanceSheet || {})
  });
  checklist.push({
    label: 'General Ledger: procurement GL lines for GRN/SIN refs',
    ok: reportCheck.generalLedgerOk,
    detail: JSON.stringify(reportCheck.details.generalLedger || {})
  });
  const plCheck = await verifyProfitLoss(api, '2026-01-01', asOfVerify);
  checklist.push({
    label: 'Profit & Loss populated (COGS/revenue rows visible for period)',
    ok: plCheck.ok,
    detail: JSON.stringify(plCheck.details || {})
  });

  const invAfter = await api.get(`/procurement/inventory/${state.inventory._id}`);
  const invData = invAfter.data?.data;
  const qtyAfter = invData?.quantity;
  const wac = invData?.averageCost;
  checklist.push({
    label: 'Inventory quantity after SIN (should be GRN qty − SIN qty)',
    ok: qtyAfter === grnQty - sinQty,
    detail: `qty=${qtyAfter}, WAC=${wac}`
  });
  log(qtyAfter === grnQty - sinQty, `Inventory qty after flow: ${qtyAfter} (expect ${grnQty - sinQty})`);

  const overall =
    results.fail === 0 &&
    reportCheck.trialBalanceOk &&
    reportCheck.balanceSheetOk &&
    reportCheck.generalLedgerOk &&
    plCheck.ok;

  printFinanceReport(overall);
  process.exit(overall ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  printFinanceReport(false);
  process.exit(1);
});
