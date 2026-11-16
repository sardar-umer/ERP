require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const axios = require('axios');
const { pickGrnBillApprover, approveGrnBillAsAuthority } = require('./helpers/grnBillApproval');

const BASE = process.env.E2E_API_URL || 'http://localhost:5001/api';
const GL = { INVENTORY: '1100', ADVANCE: '1110', AP: '2001', GRNI: '2100', COGS: '5000', CASH: '1001', BANK: '1002' };

function fail(msg, extra) {
  // eslint-disable-next-line no-console
  console.error(`✗ ${msg}`, extra || '');
  process.exit(1);
}
function ok(msg, extra) {
  // eslint-disable-next-line no-console
  console.log(`✓ ${msg}`, extra || '');
}
function lineNum(l) { return typeof l?.account === 'object' ? String(l.account.accountNumber || '') : ''; }
function balanced(e) {
  const t = (e.lines || []).reduce((s, l) => ({ dr: s.dr + (Number(l.debit) || 0), cr: s.cr + (Number(l.credit) || 0) }), { dr: 0, cr: 0 });
  return Math.abs(t.dr - t.cr) < 0.02;
}
async function journals(api, search) {
  const r = await api.get('/finance/journal-entries', { params: { limit: 40, module: 'procurement', search } });
  return r.data?.data?.entries || [];
}

/** Minimal multipart body for POST /journal-entries/:id/attachments (multer field name: file). */
function buildMultipartAttachment(boundary, filename, fileUtf8, contentType = 'text/plain') {
  const crlf = '\r\n';
  return Buffer.concat([
    Buffer.from(
      `--${boundary}${crlf}Content-Disposition: form-data; name="file"; filename="${filename}"${crlf}Content-Type: ${contentType}${crlf}${crlf}`,
      'utf8'
    ),
    Buffer.from(fileUtf8, 'utf8'),
    Buffer.from(`${crlf}--${boundary}--${crlf}`, 'utf8')
  ]);
}

/** Draft vendor advance → finance approvals → posted JE → attachment → signed (triggers PO auto-approve when full advance). */
/** Draft AP settlement (apply advance / payment) → finance approvals → posted JE */
async function finalizeApSettlementApplicationsForE2e(api, applyResult, label) {
  const apps = applyResult?.applications || [];
  const fromAdjustments = (applyResult?.adjustments || [])
    .filter((a) => a.applicationId)
    .map((a) => ({ applicationId: a.applicationId }));
  const all = apps.length ? apps : fromAdjustments;
  if (!all.length) fail(`${label}: no AP payment applications returned`, applyResult);
  for (const row of all) {
    const appId = row.applicationId || row._id;
    if (!appId) fail(`${label}: missing applicationId`, row);
    let done = false;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const appr = await api.put(`/finance/ap-payment-applications/${appId}/finance-approve`, {});
      if (!appr.data?.success) fail(`${label}: AP settlement finance approve failed`, appr.data);
      const wf = appr.data?.data?.workflowStatus;
      if (wf === 'fully_approved' || String(appr.data?.message || '').includes('finalized')) {
        done = true;
        break;
      }
    }
    if (!done && row.journalEntryId) {
      const check = await api.get(`/finance/ap-payment-applications/by-journal-entry/${row.journalEntryId}`);
      if (check.data?.data?.workflowStatus === 'fully_approved') done = true;
    }
    if (!done) fail(`${label}: AP settlement not fully approved`, row);
  }
}

async function finalizeVendorAdvanceVoucherForE2e(api, advanceResData, stamp, label) {
  const advId = advanceResData?._id;
  const jeId = advanceResData?.journalEntryId;
  if (!advId || !jeId) fail(`${label}: missing advance id or journal entry`, advanceResData);
  const appr = await api.put(`/finance/vendor-advances/${advId}/finance-approve`, {});
  if (!appr.data?.success) fail(`${label}: finance approve failed`, appr.data);
  const boundary = `e2e${stamp}`;
  const buf = buildMultipartAttachment(boundary, `e2e-voucher-${stamp}.txt`, 'e2e voucher attachment');
  const up = await api.post(`/finance/journal-entries/${jeId}/attachments`, buf, {
    headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` }
  });
  if (!up.data?.success) fail(`${label}: voucher attachment upload failed`, up.data);
  const sig = await api.put(`/finance/journal-entries/${jeId}/signed-document`, { signedDocumentStatus: 'signed' });
  if (!sig.data?.success) fail(`${label}: mark voucher signed failed`, sig.data);
}

async function run() {
  const api = axios.create({ baseURL: BASE, timeout: 120000, validateStatus: () => true });
  const login = await api.post('/auth/login', { email: 'ceo@sgc.com', password: 'ceo12345' });
  if (!login.data?.data?.token) fail('Login failed', login.data);
  api.defaults.headers.Authorization = `Bearer ${login.data.data.token}`;
  const userId = login.data.data.user?._id || login.data.data.user?.id;

  const placementCompaniesRes = await api.get('/placement-companies');
  const company = (placementCompaniesRes.data?.data?.companies || placementCompaniesRes.data?.data || [])[0];
  const companyId = company?._id || company?.id;
  if (companyId) {
    api.defaults.headers['x-company-id'] = companyId;
  }

  const accRes = await api.get('/finance/accounts', { params: { limit: 5000 } });
  const accs = accRes.data?.data?.accounts || accRes.data?.data || [];
  const has = (n) => accs.find((a) => a.accountNumber === n)?._id;
  ['1100', '2001', '2100', '5000'].forEach((n) => { if (!has(n)) fail(`Missing account ${n}`); });
  ok('Accounts available: 1100/2001/2100/5000');

  const stamp = Date.now();
  const today = new Date().toISOString().split('T')[0];
  const nextMonth = new Date(Date.now() + 30 * 864e5).toISOString().split('T')[0];
  const grnQty = 100; const sinQty = 10;

  const dep = (await api.get('/indents/departments')).data?.data?.[0];
  const venCreate = await api.post('/procurement/vendors', {
    name: `E2E ADV Vendor ${stamp}`,
    contactPerson: 'Contact Person E2E',
    email: `e2e-adv-vendor-${stamp}@example.com`,
    phone: '03001234567',
    address: 'E2E Address'
  });
  const ven = venCreate.data?.data?.vendor || venCreate.data?.data || venCreate.data;
  let projects = (await api.get('/hr/projects', { params: { limit: 20, status: 'Active' } })).data?.data?.projects || [];
  if (!projects.length) projects = (await api.get('/hr/projects', { params: { limit: 20 } })).data?.data?.projects || [];
  let prj = projects[0];
  if (!prj?._id) {
    const prjCreate = await api.post('/hr/projects', { name: `E2E Project ${stamp}`, description: 'Auto-created for advance E2E' });
    if (prjCreate.data?.success) prj = prjCreate.data.data;
  }
  let stores = (await api.get('/stores', { params: { activeOnly: 'true' } })).data?.data || [];
  if (!stores.length) stores = (await api.get('/stores')).data?.data || [];
  const store = stores[0];
  if (!dep?._id || !ven?._id || !prj?._id || !store?._id) fail('Missing master data', { dep: !!dep?._id, ven: !!ven?._id, prj: !!prj?._id, store: !!store?._id });

  const cat = ((await api.get('/inventory-categories')).data?.data || [])[0];
  const invCreate = await api.post('/procurement/inventory', {
    name: `E2E ADV Item ${stamp}`, itemCode: `E2E-ADV-${stamp}`, category: 'Raw Materials', unit: 'bag',
    quantity: 0, unitPrice: 850, minQuantity: 0, maxQuantity: 999999, ...(cat ? { inventoryCategory: cat._id } : {})
  });
  if (!invCreate.data?.success) fail('Inventory create failed', invCreate.data);
  const invId = invCreate.data.data._id;
  await api.put(`/procurement/inventory/${invId}`, { inventoryAccount: has('1100'), grniAccount: has('2100'), cogsAccount: has('5000') });

  const indent = await api.post('/indents', {
    title: `E2E ADV ${stamp}`, description: 'Advance payment flow', department: dep._id, requiredDate: nextMonth,
    justification: 'e2e', priority: 'High', category: 'Raw Materials',
    items: [{ itemName: `E2E ADV Item ${stamp}`, description: 'x', brand: 'Lucky', quantity: grnQty, unit: 'bag', purpose: 'site', estimatedCost: 850 }]
  });
  if (!indent.data?.success) fail('Indent create failed', indent.data);
  const indentId = indent.data.data._id;
  await api.post(`/indents/${indentId}/submit`); await api.post(`/indents/${indentId}/approve`);
  await api.post(`/indents/${indentId}/move-to-procurement`, { reason: 'no stock' });
  await api.put(`/procurement/requisitions/${indentId}/assign`, { assigneeId: userId, note: 'E2E' });

  const quote = await api.post('/procurement/quotations', {
    indent: indentId, vendor: ven._id, quotationDate: today, expiryDate: nextMonth, status: 'Received',
    paymentTerms: 'Full advance',
    items: [{ description: 'x', quantity: grnQty, unit: 'bag', unitPrice: 840, taxRate: 0, discount: 0 }]
  });
  if (!quote.data?.success) fail('Quotation create failed', quote.data);
  const quoteId = quote.data.data._id;
  await api.put(`/procurement/quotations/${quoteId}`, { status: 'Finalized' });
  const po = await api.post(`/procurement/quotations/${quoteId}/create-po`);
  if (!po.data?.success) fail('PO create failed', po.data);
  const poId = po.data.data._id;
  const poNo = po.data.data.orderNumber;
  await api.put(`/procurement/purchase-orders/${poId}/send-to-audit`, {});
  await api.put(`/procurement/purchase-orders/${poId}/audit-approve`, { approvalComments: 'ok' });
  await api.put(`/pre-audit/${poId}/forward`, { forwardComments: 'ok' });
  await api.put(`/procurement/purchase-orders/${poId}/audit-approve`, { approvalComments: 'ok' });
  await api.put(`/procurement/purchase-orders/${poId}/forward-to-ceo`, { comments: 'ok' });
  const ceoApprove = await api.put(`/procurement/purchase-orders/${poId}/ceo-approve`, { approvalComments: 'ok', digitalSignature: 'CEO' });
  if (!ceoApprove.data?.success) fail('CEO approve failed', ceoApprove.data);
  if (ceoApprove.data?.sentToFinance) await api.put(`/procurement/purchase-orders/${poId}/finance-approve`, { approvalComments: 'ok' });

  const advanceAmt = Math.round((Number(po.data.data.totalAmount) || grnQty * 840) * 100) / 100;

  // Step 2: advance payment before GRN/bill adjustment
  const advRef = `E2E-ADV-${stamp}`;
  const adv = await api.post('/finance/accounts-payable/advance-payment', {
    vendorName: ven.name,
    vendorEmail: ven.email || '',
    vendorId: ven._id,
    amount: advanceAmt,
    paymentMethod: 'bank_transfer',
    bankAccountId: has('1002') || has('1001'),
    reference: advRef,
    paymentDate: new Date().toISOString(),
    referenceType: 'purchase_order',
    referenceId: poId,
    financeApprovalAuthorities: {
      accountsManagerUser: userId,
      financeControllerUser: userId
    }
  });
  if (!adv.data?.success) fail('Advance payment failed', adv.data);
  ok('Advance payment created', { reference: advRef, amount: advanceAmt });
  await finalizeVendorAdvanceVoucherForE2e(api, adv.data.data, stamp, 'Advance voucher');
  const advJ = await journals(api, advRef);
  const advPattern = advJ.some((e) => balanced(e) && (e.lines || []).some((l) => Number(l.debit) > 0 && lineNum(l) === GL.ADVANCE) && (e.lines || []).some((l) => Number(l.credit) > 0 && [GL.CASH, GL.BANK].includes(lineNum(l))));
  if (!advPattern) fail('Advance journal pattern mismatch', advJ.map((e) => e.entryNumber));
  ok('Advance JE: DR 1110 / CR 1001|1002');

  // Continue operational flow
  await api.put(`/procurement/purchase-orders/${poId}/send-to-store`, { comments: 'ok' });

  const dcRes = await api.post('/procurement/delivery-challans', {
    purchaseOrder: poId,
    vendorDcReference: `VDC-${stamp}`,
    items: [{ poLineIndex: 0, quantity: grnQty }]
  });
  if (!dcRes.data?.success) fail('Delivery challan create failed', dcRes.data);
  const dcId = dcRes.data.data._id;
  const dcGate = dcRes.data.data.gatePassNo;
  if (!dcGate || !String(dcGate).startsWith('GP-')) {
    fail('Delivery challan missing auto gatePassNo', dcRes.data.data);
  }
  const dcQa = await api.patch(`/procurement/delivery-challans/${dcId}/qa`, { qaStatus: 'passed', qaRemarks: 'ok' });
  if (!dcQa.data?.success) fail('Delivery challan QA failed', dcQa.data);

  const grn = await api.post('/procurement/goods-receive', {
    receiveDate: today, project: prj._id, store: store._id, supplier: ven._id, supplierName: ven.name,
    purchaseOrder: poId, poNumber: poNo, deliveryChallan: dcId, status: 'Complete',
    items: [{ inventoryItem: invId, quantity: grnQty, unitPrice: 840, itemName: `E2E ADV Item ${stamp}`, itemCode: `E2E-ADV-${stamp}`, unit: 'bag' }]
  });
  if (!grn.data?.success) fail('GRN failed', grn.data);
  if (grn.data.data.gatePassNo !== dcGate) {
    fail('GRN gate pass should match delivery challan', { grnGate: grn.data.data.gatePassNo, dcGate });
  }
  const grnNo = grn.data.data.receiveNumber;
  const grnId = grn.data.data._id;

  // Procurement vendor bill from GRN (AP is not auto-created on PO approval in current flow)
  const billApprover = await pickGrnBillApprover(api);
  const billCreate = await api.post('/procurement/vendor-bills', {
    vendorId: ven._id,
    grnIds: [grnId],
    billDate: today,
    paymentTerms: 'net_30',
    vendorInvoiceNumber: `VINV-ADV-${stamp}`,
    approvalAuthorityId: billApprover._id
  });
  if (billCreate.status !== 201 || !billCreate.data?.success) fail('Vendor bill creation failed', billCreate.data);
  const bill = billCreate.data.data;
  if (!bill?._id) fail('Vendor bill response missing id', billCreate.data);
  if (bill.approvalStatus !== 'Submitted' || bill.status === 'Pending Audit') {
    fail('New bill should wait for its approval authority, not go straight to Audit', { status: bill.status, approvalStatus: bill.approvalStatus });
  }

  // Procurement approval authority approves → bill moves to 'Pending Audit'
  await approveGrnBillAsAuthority(BASE, billApprover, bill._id);
  ok('Bill approved by approval authority and sent to Pre-Audit', billApprover.name);

  // Pre-audit approve bill to move status from 'Pending Audit' to 'Approved'
  await api.put(`/pre-audit/${bill._id}/approve`, { approvalComments: 'Pre-audit approve' });
  await api.put(`/pre-audit/${bill._id}/forward`, { forwardComments: 'Forwarding to director' });
  await api.put(`/pre-audit/${bill._id}/approve`, { approvalComments: 'Director approve' });

  const apply = await api.post(`/finance/accounts-payable/${bill._id}/apply-advance`, {
    amount: advanceAmt,
    source: 'vendor',
    financeApprovalAuthorities: {
      accountsManagerUser: userId,
      financeControllerUser: userId
    }
  });
  if (!apply.data?.success) fail('Apply advance failed', apply.data);
  ok('Advance apply submitted (pending voucher approval)', apply.data.data);

  const afterSubmit = await api.get(`/finance/accounts-payable/${bill._id}`);
  const billPending = afterSubmit.data?.data;
  const outstandingAfterSubmit = Math.round(
    ((billPending.totalAmount || 0)
      - (billPending.amountPaid || 0)
      - (billPending.advanceApplied || 0)
      - (billPending.advancePending || 0)
      - (billPending.paymentPending || 0)) * 100
  ) / 100;
  if (billPending.status === 'paid' || (billPending.advancePending || 0) <= 0) {
    fail('Bill should not be paid until voucher authorities approve', billPending);
  }
  if (outstandingAfterSubmit > 0.02) fail('Outstanding should be zero while advance is pending approval', { outstandingAfterSubmit });

  await finalizeApSettlementApplicationsForE2e(api, apply.data.data, 'Apply-advance voucher');

  const afterApply = await api.get(`/finance/accounts-payable/${bill._id}`);
  const billAfter = afterApply.data?.data;
  const outstanding = Math.round(((billAfter.totalAmount || 0) - (billAfter.amountPaid || 0) - (billAfter.advanceApplied || 0)) * 100) / 100;
  if (!(billAfter.advanceApplied > 0 && outstanding >= 0)) fail('Bill advance not reflected after approval', { advanceApplied: billAfter.advanceApplied, outstanding });

  // Pay remaining
  if (outstanding > 0.01) {
    const pay = await api.post(`/finance/accounts-payable/${bill._id}/payment`, {
      amount: outstanding,
      paymentMethod: 'bank_transfer',
      reference: `E2E-FINALPAY-${stamp}`,
      paymentDate: new Date().toISOString(),
      financeApprovalAuthorities: {
        accountsManagerUser: userId,
        financeControllerUser: userId
      }
    });
    if (!pay.data?.success) fail('Final payment failed', pay.data);
    const payAppId = pay.data?.data?._pendingSettlement?.applicationId;
    if (payAppId) {
      await finalizeApSettlementApplicationsForE2e(
        api,
        { applications: [{ applicationId: payAppId, journalEntryId: pay.data.data._pendingSettlement.journalEntryId }] },
        'Final payment voucher'
      );
    }
  }
  const billEnd = (await api.get(`/finance/accounts-payable/${bill._id}`)).data?.data;
  const rem = Math.round(((billEnd.totalAmount || 0) - (billEnd.amountPaid || 0) - (billEnd.advanceApplied || 0)) * 100) / 100;
  if (Math.abs(rem) > 0.02) fail('Bill not fully settled', { remaining: rem, bill: billEnd.billNumber });
  ok('Bill fully settled with advance + payment');

  // Wait stock ready, then SIN (matches “inventory issuance” after bill settlement in the advance workflow)
  for (let i = 0; i < 40; i += 1) {
    const b = await api.get('/procurement/stock-balance', { params: { project: prj._id, item: invId, storeId: store._id } });
    if ((Number(b.data?.data?.balance) || 0) >= sinQty) break;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, 250));
  }
  const sin = await api.post('/procurement/goods-issue', {
    issueDate: new Date().toISOString(), project: prj._id, store: store._id, issuingLocation: store.name || 'Main Store',
    department: 'procurement', departmentName: 'Procurement', requestedBy: userId, requestedByName: 'E2E',
    purpose: 'E2E', notes: 'E2E',
    items: [{ inventoryItem: invId, qtyIssued: sinQty, quantity: sinQty, itemName: `E2E ADV Item ${stamp}`, itemCode: `E2E-ADV-${stamp}`, unit: 'bag' }]
  });
  if (!sin.data?.success) fail('SIN failed', sin.data);
  const sinNo = sin.data.data.issueNumber || sin.data.data.sinNumber;

  // Report health checks
  const asOf = new Date().toISOString().split('T')[0];
  const tb = await api.get('/finance/reports/trial-balance-v2', { params: { asOfDate: asOf } });
  const bs = await api.get('/finance/reports/balance-sheet', { params: { asOfDate: asOf } });
  const pl = await api.get('/finance/reports/profit-loss', { params: { fromDate: '2026-01-01', toDate: asOf } });
  const glGrn = await api.get('/finance/general-ledger', { params: { module: 'procurement', search: grnNo, limit: 10 } });
  const glSin = await api.get('/finance/general-ledger', { params: { module: 'procurement', search: sinNo, limit: 10 } });
  if (!tb.data?.data?.totals?.isBalanced) fail('Trial balance not balanced', tb.data?.data?.totals);
  if (!bs.data?.data?.totals?.isBalanced) fail('Balance sheet not balanced', bs.data?.data?.totals);
  if ((glGrn.data?.data?.pagination?.totalCount || 0) <= 0 || (glSin.data?.data?.pagination?.totalCount || 0) <= 0) fail('GL refs missing');
  if ((pl.data?.data?.expenses?.rows || []).length <= 0) fail('P&L has no expense rows');
  ok('TB/BS/GL/P&L checks OK');

  ok('Advance-payment full cycle E2E PASSED', { poNo, grnNo, sinNo, billNo: billEnd.billNumber, outstanding: rem });
}

run().catch((e) => fail(e.message, e.response?.data || e.stack));
