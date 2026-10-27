#!/usr/bin/env node
/**
 * Repair two ledger issues (run once after deploying the Finance fixes):
 *
 * 1. Reversed originals marked status 'reversed' were dropped from every report (reports count posted entries),
 *    so only the negative reversal showed. They are set back to 'posted' (isReversed stays true, linked to the
 *    reversal) — original + reversal then net to zero. Only when the reversal entry exists and is posted.
 * 2. Account.balance was incremented again whenever a posted entry was re-saved. Balances are rebuilt from
 *    posted journal lines.
 *
 * Usage:
 *   node server/scripts/repair-journal-reversals-and-balances.js            # dry run, prints what would change
 *   node server/scripts/repair-journal-reversals-and-balances.js --apply
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const mongoose = require('mongoose');
const { getMongooseClientOptions } = require('../config/database');
const Account = require('../models/finance/Account');
const JournalEntry = require('../models/finance/JournalEntry');

const apply = process.argv.includes('--apply');
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

(async () => {
  const uri = process.env.MONGODB_URI || process.env.MONGODB_URI_LOCAL;
  await mongoose.connect(uri, getMongooseClientOptions(uri, /localhost|127/.test(uri || '')));

  // ── 1. reversed originals back into the reports
  const reversedOriginals = await JournalEntry.find({ status: 'reversed' })
    .select('entryNumber reference reversalEntry reversedBy isReversed').lean();
  let restored = 0;
  let unmatched = 0;
  for (const je of reversedOriginals) {
    const reversalId = je.reversalEntry || je.reversedBy;
    const reversal = reversalId ? await JournalEntry.findById(reversalId).select('status entryNumber').lean() : null;
    if (!reversal || reversal.status !== 'posted') {
      unmatched += 1;
      console.log(`  ? ${je.entryNumber || je.reference || je._id}: marked reversed but no posted reversal found — left as is`);
      continue;
    }
    restored += 1;
    console.log(`  ✓ ${je.entryNumber || je.reference || je._id} → posted (reversed by ${reversal.entryNumber || reversalId})`);
    if (apply) {
      // updateOne: no save hooks, so balances are not touched here (they are rebuilt below)
      await JournalEntry.updateOne({ _id: je._id }, { $set: { status: 'posted', isReversed: true, reversalEntry: reversalId } });
    }
  }
  console.log(`\nReversed originals: ${restored} ${apply ? 'restored' : 'to restore'}, ${unmatched} without a posted reversal.`);

  // ── 2. rebuild account balances from posted lines
  const sums = await JournalEntry.aggregate([
    { $match: { status: 'posted' } },
    { $unwind: '$lines' },
    { $group: { _id: '$lines.account', net: { $sum: { $subtract: [{ $ifNull: ['$lines.debit', 0] }, { $ifNull: ['$lines.credit', 0] }] } } } }
  ]);
  const netById = new Map(sums.map((r) => [String(r._id), round2(r.net)]));
  const accounts = await Account.find({}).select('_id balance accountNumber name companyId').lean();
  let changed = 0;
  for (const acc of accounts) {
    const next = netById.get(String(acc._id)) || 0;
    const prev = round2(acc.balance);
    if (Math.abs(next - prev) < 0.01) continue;
    changed += 1;
    console.log(`  ${acc.accountNumber} ${acc.name}: ${prev} → ${next}`);
    if (apply) await Account.updateOne({ _id: acc._id }, { $set: { balance: next } });
  }
  console.log(`\nAccount balances: ${changed} ${apply ? 'corrected' : 'would change'}.`);
  if (!apply && (restored || changed)) console.log('Re-run with --apply to save.');
  await mongoose.disconnect();
})().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect();
  process.exit(1);
});
