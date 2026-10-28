/**
 * Post every Audit-Director-approved utility bill that is not in Finance yet (Accounts Payable + DR 6200 / CR AP),
 * under the bill's company. Safe to run more than once — posted bills are skipped. Usage:
 *   node server/scripts/post-approved-utility-bills.js --dry-run
 *   node server/scripts/post-approved-utility-bills.js
 * Uses MONGODB_URI in production (NODE_ENV=production), otherwise MONGODB_URI_LOCAL.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
const mongoose = require('mongoose');

const DRY = process.argv.includes('--dry-run');
const uri = process.env.NODE_ENV === 'production' ? process.env.MONGODB_URI : (process.env.MONGODB_URI_LOCAL || process.env.MONGODB_URI);

(async () => {
  await mongoose.connect(uri);
  require('../models/finance/Account');
  require('../models/finance/JournalEntry');
  require('../models/finance/FiscalPeriod');
  const UtilityBill = require('../models/hr/UtilityBill');
  const PlacementCompany = require('../models/hr/Company');
  const { postUtilityBillToFinance, resolveUtilityBillCompanyId, isUtilityBillAuditFinalApproved } = require('../utils/utilityBillFinance');

  const bills = await UtilityBill.find({
    auditStatus: /^Approved \(from /,
    $or: [{ financeApBillId: null }, { financeApBillId: { $exists: false } }],
    $and: [{ $or: [{ consolidatedIntoBillId: null }, { consolidatedIntoBillId: { $exists: false } }] }]
  });
  console.log(`${bills.length} approved bill(s) not in Finance${DRY ? ' (dry run)' : ''}\n`);

  let posted = 0; let failed = 0;
  for (const bill of bills) {
    if (!isUtilityBillAuditFinalApproved(bill.auditStatus)) continue;
    const companyId = await resolveUtilityBillCompanyId(bill);
    const company = companyId ? await PlacementCompany.findById(companyId).select('name').lean() : null;
    const label = `${bill.billId} → ${company?.name || 'no company'}`;
    if (DRY) { console.log(`  would post ${label}`); continue; }
    const actor = bill.updatedBy || bill.financePostedBy || bill.createdBy;
    const r = await postUtilityBillToFinance(bill, actor);
    if (r.posted || r.reason === 'already_posted') { posted++; console.log(`  posted  ${label}  AP ${r.billNumber || r.apId || ''}`); }
    else { failed++; console.log(`  FAILED  ${label}: ${r.error || r.reason}`); }
  }
  if (!DRY) console.log(`\nPosted ${posted}, failed ${failed}`);
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
