/**
 * Find vendor advances whose stored amount no longer matches their voucher total, and optionally fix them.
 *
 * This happens when a vendor advance voucher was edited in Vouchers before that edit synced back to the
 * advance (e.g. advance shows PKR 1,560,000 while its voucher is PKR 780,000). The voucher is treated as
 * the source of truth because it is what was posted to the ledger.
 *
 * Read-only by default — it only prints what it would change:
 *   node scripts/fix-vendor-advance-voucher-mismatch.js
 *   node scripts/fix-vendor-advance-voucher-mismatch.js --company "usman solar"
 *
 * Apply the fixes:
 *   node scripts/fix-vendor-advance-voucher-mismatch.js --company "usman solar" --apply
 *
 * Uses the same database selection as the API (MONGODB_URI in production, MONGODB_URI_LOCAL in local dev).
 * Skips (and reports) advances where the voucher total is below what was already applied to bills, and
 * intercompany advances whose two vouchers disagree with each other — those need a manual check.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const path = require('path');
const mongoose = require('mongoose');

const root = path.join(__dirname, '..');
const { getMongoUri, getMongooseClientOptions } = require(path.join(root, 'server/config/database'));
const VendorAdvance = require(path.join(root, 'server/models/finance/VendorAdvance'));
const JournalEntry = require(path.join(root, 'server/models/finance/JournalEntry'));
const PlacementCompany = require(path.join(root, 'server/models/hr/Company'));

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const companyArgIdx = args.indexOf('--company');
const COMPANY_FILTER = companyArgIdx >= 0 ? String(args[companyArgIdx + 1] || '').trim() : '';

const round2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
const pkr = (v) => `PKR ${round2(v).toLocaleString('en-PK')}`;
const voucherTotal = (je) => round2((je?.lines || []).reduce((s, l) => s + (Number(l.debit) || 0), 0));
const voucherLabel = (je) => (je ? [je.voucherSeries, je.entryNumber].filter(Boolean).join(' ') || String(je._id) : '—');

/**
 * Same rules as syncVendorAdvanceAmount in server/routes/financeAdvanced.js, as a targeted $set so older
 * records missing unrelated required fields are still corrected.
 */
function amountFixUpdate(advance, newAmount) {
  const $set = { amount: newAmount };
  const lines = advance.categoryLines || [];
  const filled = lines.map((l, i) => [l, i]).filter(([l]) => Number(l.amount) > 0);
  if (filled.length === 1) $set[`categoryLines.${filled[0][1]}.amount`] = newAmount;
  const applied = Number(advance.appliedAmount) || 0;
  $set.status = applied <= 0.009 ? 'open' : applied + 0.009 >= newAmount ? 'applied' : 'partially_applied';
  return { $set };
}

(async () => {
  const { uri, isLocal } = getMongoUri();
  if (!uri) throw new Error('No database URI configured (MONGODB_URI / MONGODB_URI_LOCAL)');
  await mongoose.connect(uri, getMongooseClientOptions(uri, isLocal));
  console.log(`Database: ${isLocal ? 'LOCAL' : 'PRODUCTION'} (${mongoose.connection.name})`);
  console.log(APPLY ? 'Mode: APPLY — mismatches will be fixed\n' : 'Mode: DRY RUN — nothing will be changed (add --apply to fix)\n');

  const filter = { $or: [{ journalEntryId: { $ne: null } }, { payingJournalEntryId: { $ne: null } }] };
  if (COMPANY_FILTER) {
    const escaped = COMPANY_FILTER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const companies = await PlacementCompany.find({ name: { $regex: escaped, $options: 'i' } }).select('name').lean();
    if (!companies.length) {
      console.log(`No company matches "${COMPANY_FILTER}".`);
      await mongoose.disconnect();
      return;
    }
    console.log(`Companies: ${companies.map((c) => c.name).join(', ')}\n`);
    const ids = companies.map((c) => c._id);
    filter.$and = [{ $or: [{ companyId: { $in: ids } }, { payingCompanyId: { $in: ids } }] }];
  }

  const advances = await VendorAdvance.find(filter).lean();
  const jeIds = advances.flatMap((a) => [a.journalEntryId, a.payingJournalEntryId]).filter(Boolean);
  const jes = await JournalEntry.find({ _id: { $in: jeIds } }).select('lines entryNumber voucherSeries status').lean();
  const jeById = new Map(jes.map((je) => [String(je._id), je]));

  let mismatched = 0;
  let fixed = 0;
  let skipped = 0;
  for (const adv of advances) {
    const je = adv.journalEntryId ? jeById.get(String(adv.journalEntryId)) : null;
    const payingJe = adv.payingJournalEntryId ? jeById.get(String(adv.payingJournalEntryId)) : null;
    const totals = [je, payingJe].filter(Boolean).map(voucherTotal);
    if (!totals.length) continue;

    const stored = round2(adv.amount);
    if (totals.every((t) => Math.abs(t - stored) <= 0.009)) continue;
    mismatched += 1;

    const desc = `${adv.reference || adv._id} — ${adv.vendor?.name || 'Vendor'}: advance ${pkr(stored)}, ` +
      `voucher ${voucherLabel(je)} ${je ? pkr(voucherTotal(je)) : '—'}` +
      (payingJe ? `, paying voucher ${voucherLabel(payingJe)} ${pkr(voucherTotal(payingJe))}` : '');

    if (totals.length === 2 && Math.abs(totals[0] - totals[1]) > 0.009) {
      skipped += 1;
      console.log(`SKIP  ${desc}\n      Its two intercompany vouchers disagree — correct the vouchers first.`);
      continue;
    }
    const target = totals[0];
    if (target + 0.009 < (Number(adv.appliedAmount) || 0)) {
      skipped += 1;
      console.log(`SKIP  ${desc}\n      Already applied ${pkr(adv.appliedAmount)} to bills, more than the voucher — needs a manual check.`);
      continue;
    }

    console.log(`${APPLY ? 'FIX ' : 'WOULD FIX'}  ${desc}\n      → set advance amount to ${pkr(target)}`);
    if (APPLY) {
      try {
        await VendorAdvance.updateOne({ _id: adv._id }, amountFixUpdate(adv, target));
        fixed += 1;
      } catch (err) {
        skipped += 1;
        console.log(`      FAILED to update: ${err.message}`);
      }
    }
  }

  console.log(`\nChecked ${advances.length} advance(s): ${mismatched} mismatched, ${APPLY ? `${fixed} fixed` : `${mismatched - skipped} fixable`}, ${skipped} skipped.`);
  await mongoose.disconnect();
})().catch(async (err) => {
  console.error('Failed:', err.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
