/**
 * One-time repair: GRNs still marked "billed" by vendor bills that were voided before
 * voiding started releasing the GRN (e.g. GR00000005 / VBILL-202610-0452).
 *
 * Recomputes each affected GRN's billedAmount from its bills that are NOT voided, so it is
 * safe to run more than once. Dry run by default; pass --apply to write.
 *
 *   node server/scripts/repair-grn-billed-after-void.js            # dry run (local)
 *   node server/scripts/repair-grn-billed-after-void.js --apply    # write
 *   MONGODB_URI=... node server/scripts/repair-grn-billed-after-void.js [--apply]
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
const mongoose = require('mongoose');

const APPLY = process.argv.includes('--apply');
const uri = process.env.REPAIR_MONGODB_URI || process.env.MONGODB_URI_LOCAL || process.env.MONGODB_URI;
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

(async () => {
  await mongoose.connect(uri, process.env.REPAIR_DIRECT ? { directConnection: true } : {});
  const db = mongoose.connection.db;
  const AP = db.collection('accountspayables');
  const GRN = db.collection('goodsreceives');

  const voided = await AP.find({ status: 'cancelled', 'linkedGRNs.0': { $exists: true } }).project({ linkedGRNs: 1 }).toArray();
  const grnIds = [...new Set(voided.flatMap((b) => b.linkedGRNs.map((l) => String(l.grnId))))].map((id) => new mongoose.Types.ObjectId(id));
  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} — GRNs linked to voided bills: ${grnIds.length}`);

  for (const grnId of grnIds) {
    const g = await GRN.findOne({ _id: grnId });
    if (!g) continue;
    const active = await AP.find({ status: { $ne: 'cancelled' }, 'linkedGRNs.grnId': grnId })
      .project({ billNumber: 1, linkedGRNs: 1, createdAt: 1 }).sort({ createdAt: -1 }).toArray();
    const billed = round2(active.reduce((s, b) => s + b.linkedGRNs.filter((l) => String(l.grnId) === String(grnId)).reduce((x, l) => x + (Number(l.amount) || 0), 0), 0));
    const total = round2((Number(g.netAmount || g.total) || 0) - (Number(g.returnedAmount) || 0));
    const billingStatus = billed <= 0.009 ? 'nothing_to_bill' : (total - billed <= 0.009 ? 'fully_billed' : 'waiting_bills');
    const latest = active[0];
    const same = round2(g.billedAmount) === billed && g.billingStatus === billingStatus
      && String(g.vendorBill || '') === String(latest?._id || '');
    console.log(`${g.receiveNumber}: billed ${round2(g.billedAmount)} → ${billed}, status ${g.billingStatus} → ${billingStatus}, bill ${g.vendorBillNumber || '-'} → ${latest?.billNumber || '-'}${same ? ' (already correct)' : ''}`);
    if (!APPLY || same) continue;
    const update = { $set: { billedAmount: billed, billingStatus } };
    if (latest) Object.assign(update.$set, { vendorBill: latest._id, vendorBillNumber: latest.billNumber });
    else update.$unset = { vendorBill: '', vendorBillNumber: '' };
    await GRN.updateOne({ _id: grnId }, update);
  }
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
