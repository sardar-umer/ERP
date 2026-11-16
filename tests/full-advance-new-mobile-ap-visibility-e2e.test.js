require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const axios = require('axios');
const { pickGrnBillApprover, approveGrnBillAsAuthority } = require('./helpers/grnBillApproval');

const BASE = process.env.E2E_API_URL || 'http://localhost:5001/api';
const ACC = {
  INVENTORY: '1100',
  GRNI: '2100',
  COGS: '5000'
};

function fail(msg, extra) {
  // eslint-disable-next-line no-console
  console.error(`✗ ${msg}`, extra || '');
  process.exit(1);
}
function ok(msg, extra) {
  // eslint-disable-next-line no-console
  console.log(`✓ ${msg}`, extra || '');
}

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
  const stamp = Date.now();
  const today = new Date().toISOString().split('T')[0];
  const nextMonth = new Date(Date.now() + 30 * 864e5).toISOString().split('T')[0];

  // 1) Login
  const login = await api.post('/auth/login', { email: 'ceo@sgc.com', password: 'ceo12345' });
  if (!login.data?.data?.token) fail('Login failed', login.data);
  api.defaults.headers.Authorization = `Bearer ${login.data.data.token}`;
  const userId = login.data.data.user?._id || login.data.data.user?.id;

  // 2) Ensure default accounts and resolve account ids
  const ensure = await api.post('/finance/accounts/ensure-defaults');
  if (!ensure.data?.success) fail('ensure-defaults failed', ensure.data);
  const allAcc = ensure.data?.data || [];
  const accId = (num) => allAcc.find((a) => a.accountNumber === num)?._id;
  Object.values(ACC).forEach((n) => { if (!accId(n)) fail(`Missing account ${n}`); });

  // 3) Create or reuse inventory category: new-mobile
  const catRes = await api.get('/inventory-categories', { params: { isActive: 'all' } });
  const categories = catRes.data?.data || [];
  let category = categories.find((c) => String(c.name || '').toLowerCase() === 'new-mobile');
  if (!category) {
    const createCat = await api.post('/inventory-categories', {
      name: 'new-mobile',
      description: 'E2E category for full advance AP visibility',
      stockValuationAccount: accId(ACC.INVENTORY),
      stockInputAccount: accId(ACC.GRNI),
      stockOutputAccount: accId(ACC.COGS)
    });
    if (!createCat.data?.success) fail('Category creation failed', createCat.data);
    category = createCat.data.data;
  }
  ok('Inventory category ready', { name: category.name, id: category._id });

  // 4) Create inventory item "samsung" and attach finance mapping + category
  const itemCode = `SAMSUNG-${stamp}`;
  const createItem = await api.post('/procurement/inventory', {
    name: 'samsung',
    itemCode,
    category: 'Raw Materials',
    unit: 'pcs',
    quantity: 0,
    unitPrice: 1500,
    minQuantity: 0,
    maxQuantity: 999999,
    inventoryCategory: category._id
  });
  if (!createItem.data?.success) fail('Inventory item creation failed', createItem.data);
  const inv = createItem.data.data;
  const updateItem = await api.put(`/procurement/inventory/${inv._id}`, {
    inventoryCategory: category._id,
    inventoryAccount: accId(ACC.INVENTORY),
    grniAccount: accId(ACC.GRNI),
    cogsAccount: accId(ACC.COGS)
  });
  if (!updateItem.data?.success) fail('Inventory item finance mapping failed', updateItem.data);
  ok('Item with finance mapping ready', { name: 'samsung', itemCode });

  // 5) Master data for procurement flow
  const dep = (await api.get('/indents/departments')).data?.data?.[0];
  const vendorList = (await api.get('/procurement/vendors', { params: { limit: 50 } })).data?.data?.vendors || [];
  let vendor = vendorList[0];
  if (!vendor?._id) {
    const createVendor = await api.post('/procurement/vendors', {
      name: `E2E Vendor ${stamp}`,
      email: `e2e-vendor-${stamp}@example.com`,
      phone: '03001234567',
      address: 'E2E Address'
    });
    if (!createVendor.data?.success) fail('Vendor creation failed', createVendor.data);
    vendor = createVendor.data.data;
  }
  let projects = (await api.get('/hr/projects', { params: { limit: 20, status: 'Active' } })).data?.data?.projects || [];
  if (!projects.length) projects = (await api.get('/hr/projects', { params: { limit: 20 } })).data?.data?.projects || [];
  let project = projects[0];
  if (!project?._id) {
    const p = await api.post('/hr/projects', { name: `E2E Project ${stamp}`, description: 'Created by AP visibility test' });
    if (!p.data?.success) fail('Project creation failed', p.data);
    project = p.data.data;
  }
  let stores = (await api.get('/stores', { params: { activeOnly: 'true' } })).data?.data || [];
  if (!stores.length) stores = (await api.get('/stores')).data?.data || [];
  const store = stores[0];
  if (!dep?._id || !vendor?._id || !project?._id || !store?._id) fail('Missing master data', { dep: !!dep?._id, vendor: !!vendor?._id, project: !!project?._id, store: !!store?._id });

  // 6) Full advance cycle start: indent -> quotation -> PO approvals
  const qty = 10;
  const unitPrice = 1200;
  const total = qty * unitPrice;
  const indent = await api.post('/indents', {
    title: `E2E FULL ADV ${stamp}`,
    description: 'Full advance AP visibility flow',
    department: dep._id,
    requiredDate: nextMonth,
    justification: 'E2E',
    priority: 'High',
    category: 'Raw Materials',
    items: [{ itemName: 'samsung', description: 'mobile item', brand: 'Samsung', quantity: qty, unit: 'pcs', purpose: 'site', estimatedCost: unitPrice }]
  });
  if (!indent.data?.success) fail('Indent creation failed', indent.data);
  const indentId = indent.data.data._id;
  await api.post(`/indents/${indentId}/submit`);
  await api.post(`/indents/${indentId}/approve`);
  await api.post(`/indents/${indentId}/move-to-procurement`, { reason: 'required' });

  const quote = await api.post('/procurement/quotations', {
    indent: indentId,
    vendor: vendor._id,
    quotationDate: today,
    expiryDate: nextMonth,
    status: 'Received',
    items: [{ description: 'samsung mobile', quantity: qty, unit: 'pcs', unitPrice, taxRate: 0, discount: 0 }]
  });
  if (!quote.data?.success) fail('Quotation creation failed', quote.data);
  const quoteId = quote.data.data._id;
  await api.put(`/procurement/quotations/${quoteId}`, { status: 'Finalized' });

  const po = await api.post(`/procurement/quotations/${quoteId}/create-po`);
  if (!po.data?.success) fail('PO creation failed', po.data);
  const poId = po.data.data._id;
  await api.put(`/procurement/purchase-orders/${poId}/send-to-audit`, {});
  await api.put(`/procurement/purchase-orders/${poId}/audit-approve`, { approvalComments: 'ok' });
  await api.put(`/procurement/purchase-orders/${poId}/forward-to-ceo`, { comments: 'ok' });
  const ceo = await api.put(`/procurement/purchase-orders/${poId}/ceo-approve`, { approvalComments: 'ok', digitalSignature: 'CEO' });
  if (!ceo.data?.success) fail('CEO approve failed', ceo.data);
  if (ceo.data?.sentToFinance) await api.put(`/procurement/purchase-orders/${poId}/finance-approve`, { approvalComments: 'ok' });

  // 7) Full advance before GRN
  const adv = await api.post('/finance/accounts-payable/advance-payment', {
    vendorName: vendor.name,
    vendorEmail: vendor.email || '',
    vendorId: vendor._id,
    amount: total,
    paymentMethod: 'bank_transfer',
    bankAccountId: accId('1002') || accId('1001'),
    reference: `ADV-FULL-${stamp}`,
    paymentDate: new Date().toISOString(),
    referenceType: 'purchase_order',
    referenceId: poId,
    financeApprovalAuthorities: {
      accountsManagerUser: userId,
      financeControllerUser: userId
    }
  });
  if (!adv.data?.success) fail('Vendor advance failed', adv.data);
  await finalizeVendorAdvanceVoucherForE2e(api, adv.data.data, stamp, 'Full advance voucher');

  // 8) GRN
  await api.put(`/procurement/purchase-orders/${poId}/send-to-store`, { comments: 'ok' });
  const grn = await api.post('/procurement/goods-receive', {
    receiveDate: today,
    project: project._id,
    store: store._id,
    supplier: vendor._id,
    supplierName: vendor.name,
    purchaseOrder: poId,
    poNumber: po.data.data.orderNumber,
    status: 'Complete',
    items: [{ inventoryItem: inv._id, quantity: qty, unitPrice, itemName: 'samsung', itemCode, unit: 'pcs' }]
  });
  if (!grn.data?.success) fail('GRN failed', grn.data);
  const grnId = grn.data.data._id;

  // 9) Create vendor bill (this is what should appear in Accounts Payable)
  const billApprover = await pickGrnBillApprover(api);
  const createBill = await api.post('/procurement/vendor-bills', {
    vendorId: vendor._id,
    grnIds: [grnId],
    billDate: today,
    paymentTerms: 'net_30',
    vendorInvoiceNumber: `VINV-${stamp}`,
    approvalAuthorityId: billApprover._id
  });
  if (createBill.status !== 201 || !createBill.data?.success) fail('Vendor bill create failed', createBill.data);
  const bill = createBill.data.data;
  ok('Vendor bill created', { billNumber: bill.billNumber, id: bill._id });

  // Procurement approval authority approves → bill moves to 'Pending Audit' (as before this step existed)
  await approveGrnBillAsAuthority(BASE, billApprover, bill._id);
  ok('Bill approved by approval authority', billApprover.name);

  // 10) Verify bill is visible in Accounts Payable list
  const apList = await api.get('/finance/accounts-payable', {
    params: {
      search: bill.billNumber,
      page: 1,
      limit: 20,
      startDate: '2020-01-01',
      endDate: '2100-12-31'
    }
  });
  if (!apList.data?.success) fail('AP list fetch failed', apList.data);
  const bills = apList.data?.data?.bills || [];
  const found = bills.find((b) => String(b._id) === String(bill._id) || String(b.billNumber) === String(bill.billNumber));
  if (!found) fail('Bill created from GRN is not visible in Accounts Payable list', { billNumber: bill.billNumber, count: bills.length });

  ok('AP visibility verified', { billNumber: bill.billNumber, status: found.status, totalAmount: found.totalAmount });
  ok('TEST PASS: full advance flow + new-mobile/samsung + AP visible');
}

run().catch((e) => fail(e.message, e.response?.data || e.stack));
