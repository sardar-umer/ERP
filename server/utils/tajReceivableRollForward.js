/**
 * Taj Utilities — receivable roll-forward (accountant's view).
 *
 *   Opening + Brought forward + Billed + Bill adjustments − Received = Closing receivable
 *
 * Built only from what each bill itself adds (its own charges) and dated payments recorded on bills.
 * Stored `totalArrears` is NOT summed: arrears are a carried-forward copy of earlier bills' unpaid
 * amounts and get re-written when older bills are paid, so summing them double-counts and moves over
 * time. The only arrears used are those on the first bill of each property/section/meter ("Brought
 * forward"): balances owed from before the system.
 *
 * Read-only.
 */
const mongoose = require('mongoose');
const PropertyInvoice = require('../models/tajResidencia/PropertyInvoice');
const TajTransaction = require('../models/tajResidencia/TajTransaction');
const TajResident = require('../models/tajResidencia/TajResident');
const TajProperty = require('../models/tajResidencia/TajProperty');
const { getCached, setCached } = require('./tajUtilitiesOptimizer');

// Same rows as the Dashboard charge summary
const CHARGE_KEYS = ['ELECTRICITY', 'CAM', 'RENT', 'WATER', 'GROUND', 'OTHER'];

const chargeKey = (chargeType) => {
  const t = String(chargeType == null ? '' : chargeType).trim().toUpperCase().replace(/\s+/g, '_');
  if (t.includes('GROUND')) return 'GROUND';
  if (t === 'RENT' || t === 'REN') return 'RENT';
  if (t === 'CAM' || t === 'CMC') return 'CAM';
  if (t === 'WATER' || t === 'WTR') return 'WATER';
  if (t === 'ELECTRICITY' || t === 'ELC') return 'ELECTRICITY';
  return 'OTHER';
};

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const monthsBetween = (fromMonth, toMonth) => {
  const out = [];
  let [y, m] = fromMonth.split('-').map(Number);
  const [ty, tm] = toMonth.split('-').map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
};

const monthLabel = (key) => {
  const [y, m] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
};

// ---------- Resident Ledger rules (client/src/utils/residentLedgerDisplay.js) ----------
const LEDGER_GRACE_PERIOD_DAYS = 6;
const LEDGER_SECTION_TYPES = ['CAM', 'WATER', 'ELECTRICITY', 'RENT'];

const ledgerInvoiceDisplayAmount = (inv) => {
  let chargesForMonth = Number(inv.subtotal) || 0;
  if (Array.isArray(inv.charges) && inv.charges.length > 0) {
    const totalChargesAmount = inv.charges.reduce((sum, charge) => sum + (Number(charge.amount) || 0), 0);
    if (totalChargesAmount > 0) chargesForMonth = totalChargesAmount;
  }
  const totalArrears = Number(inv.totalArrears) || 0;
  const baseAmount = chargesForMonth + totalArrears;
  if (!inv.dueDate) return Number(inv.grandTotal) || baseAmount;

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const graceEndDate = new Date(inv.dueDate);
  graceEndDate.setHours(0, 0, 0, 0);
  graceEndDate.setDate(graceEndDate.getDate() + LEDGER_GRACE_PERIOD_DAYS);
  const isUnpaid = inv.paymentStatus === 'unpaid' || inv.paymentStatus === 'partial_paid' || (Number(inv.balance) || 0) > 0;
  if (!(todayStart > graceEndDate) || !isUnpaid) return Number(inv.grandTotal) || baseAmount;

  const latePaymentSurcharge = Math.max(Math.round(chargesForMonth * 0.1), 0);
  const storedGrandTotal = Number(inv.grandTotal) || 0;
  return storedGrandTotal > baseAmount ? storedGrandTotal : baseAmount + latePaymentSurcharge;
};

const ledgerSectionKey = (inv) => {
  const types = inv.chargeTypes || [];
  return types.length === 1 && LEDGER_SECTION_TYPES.includes(types[0]) ? types[0] : 'OTHER';
};

const ledgerPeriodKey = (value) => (value ? new Date(value).toISOString() : '');

/**
 * A resident's outstanding split per invoice without double-counting carried arrears:
 * per charge-type section and property only the earliest unpaid invoice keeps its arrears.
 * Returns the invoices that still owe, with { inv, balance }.
 */
const ledgerOutstandingRows = (invoices) => {
  const sections = {};
  invoices.forEach(inv => { (sections[ledgerSectionKey(inv)] = sections[ledgerSectionKey(inv)] || []).push(inv); });
  const rows = [];
  Object.values(sections).forEach(list => {
    const sorted = [...list].sort((a, b) => {
      const cmp = ledgerPeriodKey(a.periodFrom || a.invoiceDate).localeCompare(ledgerPeriodKey(b.periodFrom || b.invoiceDate));
      return cmp !== 0 ? cmp : ledgerPeriodKey(a.invoiceDate).localeCompare(ledgerPeriodKey(b.invoiceDate));
    });
    const stillOwes = (inv) => (Number(inv.balance) || 0) > 0 || ['unpaid', 'partial_paid'].includes(String(inv.paymentStatus || '').toLowerCase());
    // One arrears chain per property: each property's earliest owing invoice keeps its arrears
    const byProperty = {};
    sorted.forEach(inv => { const k = String(inv.property?._id || inv.property || ''); (byProperty[k] = byProperty[k] || []).push(inv); });
    const firstIds = new Set(Object.values(byProperty).map(l => (l.find(stillOwes) || l[0])._id.toString()));
    sorted.forEach(inv => {
      const displayAmount = ledgerInvoiceDisplayAmount(inv);
      const totalPaid = Number(inv.totalPaid) || 0;
      const totalArrears = Number(inv.totalArrears) || 0;
      const balance = firstIds.has(inv._id.toString())
        ? Math.max(0, displayAmount - totalPaid)
        : Math.max(0, displayAmount - totalArrears - totalPaid);
      if (balance > 0.005) rows.push({ inv, balance });
    });
  });
  return rows;
};

// ---------- Per-invoice split by charge type ----------

/** Weights for splitting money received on a bill across its charge types (by line total, like Deposits "Used"). */
const paymentWeights = (inv) => {
  const lines = Array.isArray(inv.charges) ? inv.charges : [];
  const weights = {};
  let total = 0;
  lines.forEach(line => {
    const w = Math.max(0, Number(line.total) || (Number(line.amount) || 0) + (Number(line.arrears) || 0));
    if (w <= 0) return;
    const key = chargeKey(line.type);
    weights[key] = (weights[key] || 0) + w;
    total += w;
  });
  if (total <= 0) return { [chargeKey((inv.chargeTypes || [])[0])]: 1 };
  Object.keys(weights).forEach(k => { weights[k] /= total; });
  return weights;
};

const emptyKeys = () => CHARGE_KEYS.reduce((acc, k) => ({ ...acc, [k]: 0 }), {});

const findSuspenseResidentIds = async () => {
  const unknown = await TajResident.find({
    $or: [
      { name: { $exists: false } }, { name: null }, { name: '' },
      { residentId: { $exists: false } }, { residentId: null }, { residentId: '' }
    ]
  }).select('_id').lean();
  return new Set(unknown.map(r => r._id.toString()));
};

// ---------- MongoDB aggregation: everything is totalled in the database ----------

const num = (expr) => ({ $convert: { input: expr, to: 'double', onError: 0, onNull: 0 } });

/** Shared per-invoice projection: own charge lines, adjustment, payment weights, payments, carried arrears lines. */
const invoiceShapeStages = (timezone) => [
  { $match: { status: { $ne: 'Cancelled' } } },
  { $project: {
    property: { $ifNull: ['$property', null] },
    invoiceDate: 1,
    periodFrom: 1,
    billMonth: { $dateToString: { format: '%Y-%m', date: { $ifNull: ['$periodTo', { $ifNull: ['$invoiceDate', '$createdAt'] }] } } },
    chargeTypes: { $ifNull: ['$chargeTypes', []] },
    firstType: { $ifNull: [{ $arrayElemAt: [{ $ifNull: ['$chargeTypes', []] }, 0] }, ''] },
    charges: { $ifNull: ['$charges', []] },
    subtotal: num('$subtotal'),
    grandTotal: num('$grandTotal'),
    totalArrears: num('$totalArrears'),
    payments: { $ifNull: ['$payments', []] },
    electricityBill: 1,
    invoiceNumber: 1
  } },
  { $addFields: {
    ownLines: {
      $map: {
        input: { $filter: { input: '$charges', as: 'c', cond: { $ne: [num('$$c.amount'), 0] } } },
        as: 'c',
        in: { type: '$$c.type', amount: num('$$c.amount') }
      }
    },
    pwLines: {
      $filter: {
        input: {
          $map: {
            input: '$charges',
            as: 'c',
            in: {
              type: '$$c.type',
              w: { $max: [0, { $cond: [{ $ne: [num('$$c.total'), 0] }, num('$$c.total'), { $add: [num('$$c.amount'), num('$$c.arrears')] }] }] }
            }
          }
        },
        as: 'l',
        cond: { $gt: ['$$l.w', 0] }
      }
    },
    arrLines: {
      $map: {
        input: { $filter: { input: '$charges', as: 'c', cond: { $ne: [num('$$c.arrears'), 0] } } },
        as: 'c',
        in: { type: '$$c.type', arrears: num('$$c.arrears') }
      }
    },
    pays: {
      $map: {
        input: { $filter: { input: '$payments', as: 'p', cond: { $ne: [num('$$p.amount'), 0] } } },
        as: 'p',
        in: {
          amount: num('$$p.amount'),
          noDate: { $eq: [{ $ifNull: ['$$p.paymentDate', null] }, null] },
          month: { $dateToString: { format: '%Y-%m', timezone, date: { $ifNull: ['$$p.paymentDate', { $ifNull: ['$$p.recordedAt', '$invoiceDate'] }] } } }
        }
      }
    }
  } },
  { $addFields: {
    // Old invoices without charge lines: one line of subtotal, else grandTotal less arrears
    ownLines: {
      $cond: [
        { $gt: [{ $size: '$ownLines' }, 0] },
        '$ownLines',
        {
          $filter: {
            input: [{ type: '$firstType', amount: { $cond: [{ $ne: ['$subtotal', 0] }, '$subtotal', { $max: [0, { $subtract: ['$grandTotal', '$totalArrears'] }] }] } }],
            as: 'l',
            cond: { $ne: ['$$l.amount', 0] }
          }
        }
      ]
    },
    pwLines: { $cond: [{ $gt: [{ $size: '$pwLines' }, 0] }, '$pwLines', [{ type: '$firstType', w: 1 }]] }
  } },
  { $addFields: {
    ownTotal: { $sum: '$ownLines.amount' },
    wsum: { $sum: '$pwLines.w' }
  } },
  { $addFields: {
    // Anything on the bill beyond its own charges and carried arrears (stored late surcharge, rounding)
    adj: { $cond: [{ $gt: ['$grandTotal', 0] }, { $subtract: [{ $subtract: ['$grandTotal', '$totalArrears'] }, '$ownTotal'] }, 0] }
  } },
  { $addFields: { adj: { $cond: [{ $gt: [{ $abs: '$adj' }, 0.005] }, '$adj', 0] } } }
];

const runInvoiceAggregation = async (timezone) => {
  const [result] = await PropertyInvoice.aggregate([
    ...invoiceShapeStages(timezone),
    { $facet: {
      // Own charges + adjustment split by own charges, per bill month and charge type
      billed: [
        { $unwind: '$ownLines' },
        { $group: {
          _id: { m: '$billMonth', t: '$ownLines.type', inv: '$_id' },
          billed: { $sum: '$ownLines.amount' },
          adj: { $sum: { $cond: [{ $gt: ['$ownTotal', 0] }, { $multiply: ['$adj', { $divide: ['$ownLines.amount', '$ownTotal'] }] }, 0] } }
        } },
        { $group: { _id: { m: '$_id.m', t: '$_id.t' }, billed: { $sum: '$billed' }, adj: { $sum: '$adj' }, invoices: { $sum: 1 } } }
      ],
      // Adjustment on bills with no positive own charges: split like payments
      adjNoCharges: [
        { $match: { ownTotal: { $lte: 0 }, adj: { $ne: 0 } } },
        { $unwind: '$pwLines' },
        { $group: { _id: { m: '$billMonth', t: '$pwLines.type' }, adj: { $sum: { $multiply: ['$adj', { $divide: ['$pwLines.w', '$wsum'] }] } } } }
      ],
      // Payments by payment month, split across the bill's charge types by line total
      received: [
        { $unwind: '$pays' },
        { $group: {
          _id: { inv: '$_id', m: '$pays.month' },
          amount: { $sum: '$pays.amount' },
          noDate: { $sum: { $cond: ['$pays.noDate', 1, 0] } },
          pwLines: { $first: '$pwLines' },
          wsum: { $first: '$wsum' }
        } },
        { $unwind: '$pwLines' },
        { $group: {
          _id: { m: '$_id.m', t: '$pwLines.type' },
          received: { $sum: { $multiply: ['$amount', { $divide: ['$pwLines.w', '$wsum'] }] } },
          noDate: { $sum: '$noDate' }
        } }
      ],
      // First bill of each property + ledger section + meter (open invoices: each on its own) — its arrears are
      // the balance brought forward. Properties with 2–3 electricity meters (bills -M1/-M2/-M3) have one series
      // per meter, each with its own opening arrears.
      broughtForward: [
        { $lookup: {
          from: 'electricities',
          localField: 'electricityBill',
          foreignField: '_id',
          as: 'meterDoc',
          pipeline: [{ $project: { meterNo: 1 } }]
        } },
        { $addFields: {
          meter: {
            $ifNull: [
              { $arrayElemAt: ['$meterDoc.meterNo', 0] },
              { $ifNull: [{ $getField: { field: 'match', input: { $regexFind: { input: { $ifNull: ['$invoiceNumber', ''] }, regex: /-M\d+$/ } } } }, ''] }
            ]
          }
        } },
        { $addFields: {
          section: {
            $cond: [
              { $and: [{ $eq: [{ $size: '$chargeTypes' }, 1] }, { $in: ['$firstType', LEDGER_SECTION_TYPES] }] },
              '$firstType',
              'OTHER'
            ]
          },
          sortKey: { $ifNull: ['$periodFrom', '$invoiceDate'] }
        } },
        { $sort: { sortKey: 1, invoiceDate: 1, _id: 1 } },
        { $group: {
          _id: { $cond: [{ $eq: ['$property', null] }, { inv: '$_id' }, { p: '$property', s: '$section', meter: '$meter' }] },
          first: { $first: { m: '$billMonth', arrears: '$totalArrears', arrLines: '$arrLines', pwLines: '$pwLines', wsum: '$wsum' } }
        } },
        // Only meter series that start in the property's first billing month for that section are opening
        // balances. A series starting later (meter replaced, bill not linked to its meter, or arrears copied
        // from another meter) carries amounts already in the system and would be counted twice.
        { $group: {
          _id: { $cond: [{ $ifNull: ['$_id.inv', false] }, { inv: '$_id.inv' }, { p: '$_id.p', s: '$_id.s' }] },
          firstMonth: { $min: '$first.m' },
          series: { $push: '$first' }
        } },
        { $unwind: '$series' },
        { $match: { $expr: { $and: [{ $eq: ['$series.m', '$firstMonth'] }, { $gt: ['$series.arrears', 0] }] } } },
        { $replaceRoot: { newRoot: '$series' } }
      ]
    } }
  ]).allowDiskUse(true);
  return result;
};

const runBankAggregation = async ({ fromMonth, toMonth, timezone }) => {
  const suspenseIds = [...(await findSuspenseResidentIds())].map(id => new mongoose.Types.ObjectId(id));
  const rangeStart = new Date(`${fromMonth}-01T00:00:00Z`);
  rangeStart.setUTCDate(rangeStart.getUTCDate() - 1);
  const rangeEnd = new Date(`${toMonth}-01T00:00:00Z`);
  rangeEnd.setUTCMonth(rangeEnd.getUTCMonth() + 1);
  rangeEnd.setUTCDate(rangeEnd.getUTCDate() + 1);
  const monthExpr = { $dateToString: { format: '%Y-%m', date: '$createdAt', timezone } };
  const [deposits, billPayments] = await Promise.all([
    TajTransaction.aggregate([
      { $match: {
        transactionType: 'deposit',
        createdAt: { $gte: rangeStart, $lt: rangeEnd },
        $or: [
          { referenceNumberExternal: { $not: /^REV-/ } },
          { referenceNumberExternal: { $exists: false } },
          { referenceNumberExternal: null }
        ]
      } },
      { $group: { _id: { m: monthExpr, suspense: { $in: ['$resident', suspenseIds] } }, amount: { $sum: num('$amount') } } }
    ]),
    TajTransaction.aggregate([
      { $match: { transactionType: 'bill_payment', createdAt: { $gte: rangeStart, $lt: rangeEnd } } },
      { $group: { _id: { m: monthExpr, linked: { $ne: [{ $ifNull: ['$referenceId', null] }, null] } }, amount: { $sum: num('$amount') } } }
    ])
  ]);
  return { deposits, billPayments };
};

/**
 * Resident Ledger check (slow: loads every bill). Total the Resident Ledger would show today,
 * split to the selected charge types, plus what summing stored bill balances gives.
 */
const buildLedgerCheck = async (keySet) => {
  const invoices = await PropertyInvoice.find({ status: { $ne: 'Cancelled' } })
    .select('property chargeTypes charges subtotal totalArrears grandTotal totalPaid balance paymentStatus dueDate periodFrom invoiceDate')
    .lean();
  const props = await TajProperty.find({ resident: { $ne: null } }).select('_id resident').lean();
  const residentByProperty = new Map(props.map(p => [p._id.toString(), p.resident.toString()]));
  const groups = new Map();
  for (const inv of invoices) {
    const gKey = inv.property
      ? (residentByProperty.get(inv.property.toString()) || `p:${inv.property}`)
      : `inv:${inv._id}`;
    if (!groups.has(gKey)) groups.set(gKey, []);
    groups.get(gKey).push(inv);
  }
  const shareOf = (inv) => Object.entries(paymentWeights(inv)).filter(([k]) => keySet.has(k)).reduce((s, [, v]) => s + v, 0);
  let ledgerTotal = 0;
  let surchargeNotOnBills = 0;
  for (const list of groups.values()) {
    for (const { inv, balance } of ledgerOutstandingRows(list)) {
      const share = shareOf(inv);
      ledgerTotal += balance * share;
      const surcharge = Math.max(0, ledgerInvoiceDisplayAmount(inv) - (Number(inv.grandTotal) || 0));
      surchargeNotOnBills += Math.min(surcharge, balance) * share;
    }
  }
  const storedBalanceSum = invoices.reduce((s, inv) => s + Math.max(0, Number(inv.balance) || 0) * shareOf(inv), 0);
  // Paid more than the bill's total (late surcharge paid but never saved on the bill, arrears paid twice):
  // this page counts the extra as received, the ledger shows such bills as 0
  const paidAboveBill = invoices.reduce((s, inv) => {
    const over = (Number(inv.totalPaid) || 0) - (Number(inv.grandTotal) || 0);
    return over > 0.5 ? s + over * shareOf(inv) : s;
  }, 0);
  return { ledgerTotal, surchargeNotOnBills, storedBalanceSum, paidAboveBill };
};

const CACHE_TTL_MS = 2 * 60 * 1000;

/**
 * @param {object} opts
 * @param {string} opts.startMonth YYYY-MM
 * @param {string} opts.endMonth   YYYY-MM
 * @param {string} opts.timezone   IANA zone for payment / deposit dates (default Asia/Karachi)
 * @param {string[]} [opts.chargeKeys] subset of CHARGE_KEYS to include (default all)
 * @param {boolean} [opts.includeLedgerCheck] also compare with the Resident Ledger total (slow)
 * @param {boolean} [opts.refresh] skip the 2-minute cache
 */
const buildReceivableRollForward = async ({ startMonth, endMonth, timezone = 'Asia/Karachi', chargeKeys, includeLedgerCheck = false, refresh = false } = {}) => {
  const monthPattern = /^\d{4}-(0[1-9]|1[0-2])$/;
  if (!monthPattern.test(String(startMonth)) || !monthPattern.test(String(endMonth))) {
    throw new Error('startMonth and endMonth must be YYYY-MM');
  }
  const [fromMonth, toMonth] = startMonth <= endMonth ? [startMonth, endMonth] : [endMonth, startMonth];
  if (monthsBetween(fromMonth, toMonth).length > 120) throw new Error('Range is limited to 120 months');
  const keys = Array.isArray(chargeKeys) && chargeKeys.length
    ? CHARGE_KEYS.filter(k => chargeKeys.includes(k))
    : CHARGE_KEYS;
  const keySet = new Set(keys);
  const months = monthsBetween(fromMonth, toMonth);
  const monthSet = new Set(months);

  const cacheKey = `taj_receivable_rollforward_${fromMonth}_${toMonth}_${timezone}_${keys.join(',')}_${includeLedgerCheck ? 'check' : 'nocheck'}`;
  if (!refresh) {
    const cached = getCached(cacheKey, CACHE_TTL_MS);
    if (cached) return { ...cached, cached: true };
  }

  const [agg, bankAgg, ledger] = await Promise.all([
    runInvoiceAggregation(timezone),
    runBankAggregation({ fromMonth, toMonth, timezone }),
    includeLedgerCheck ? buildLedgerCheck(keySet) : Promise.resolve(null)
  ]);

  const opening = { broughtForward: emptyKeys(), billed: emptyKeys(), adjustments: emptyKeys(), received: emptyKeys() };
  const byMonth = {};
  months.forEach(m => { byMonth[m] = { broughtForward: emptyKeys(), billed: emptyKeys(), adjustments: emptyKeys(), received: emptyKeys(), invoiceCount: emptyKeys() }; });
  const allTime = { broughtForward: 0, billed: 0, adjustments: 0, received: 0 };
  const quality = { paymentsWithoutDate: 0, receivedAfterRange: 0, billedWithoutMonth: 0 };

  // Put an amount for (month, charge key) into opening / a month / nowhere (after range)
  const post = (month, key, field, amount) => {
    if (!keySet.has(key) || !amount) return;
    allTime[field] += amount;
    if (!month) return;
    if (month < fromMonth) opening[field][key] += amount;
    else if (monthSet.has(month)) byMonth[month][field][key] += amount;
    else if (field === 'received') quality.receivedAfterRange += amount;
  };

  for (const r of agg.billed) {
    const key = chargeKey(r._id.t);
    if (!r._id.m) quality.billedWithoutMonth += r.billed;
    post(r._id.m, key, 'billed', r.billed);
    post(r._id.m, key, 'adjustments', r.adj);
    if (keySet.has(key) && monthSet.has(r._id.m)) byMonth[r._id.m].invoiceCount[key] += r.invoices;
  }
  for (const r of agg.adjNoCharges) post(r._id.m, chargeKey(r._id.t), 'adjustments', r.adj);
  for (const r of agg.received) {
    quality.paymentsWithoutDate += r.noDate || 0;
    post(r._id.m, chargeKey(r._id.t), 'received', r.received);
  }
  for (const b of agg.broughtForward) {
    const split = {};
    (b.arrLines || []).forEach(l => { const k = chargeKey(l.type); split[k] = (split[k] || 0) + l.arrears; });
    const lineSum = Object.values(split).reduce((s, v) => s + v, 0);
    const parts = Math.abs(lineSum - b.arrears) > 0.5
      ? Object.fromEntries((b.pwLines || []).reduce((acc, l) => {
        const k = chargeKey(l.type);
        const prev = acc.find(([kk]) => kk === k);
        const share = b.arrears * (l.w / b.wsum);
        if (prev) prev[1] += share; else acc.push([k, share]);
        return acc;
      }, []))
      : split;
    Object.entries(parts).forEach(([k, v]) => post(b.m, k, 'broughtForward', v));
  }
  // allTime counted only selected keys via post(); billed/adj before range also count (post adds before branching)

  // Roll forward month by month
  const movement = (b, k) => b.broughtForward[k] + b.billed[k] + b.adjustments[k] - b.received[k];
  let openingByKey = emptyKeys();
  keys.forEach(k => { openingByKey[k] = movement(opening, k); });

  const sumKeys = (obj) => keys.reduce((s, k) => s + (obj[k] || 0), 0);
  const monthRows = months.map(m => {
    const b = byMonth[m];
    const rows = keys.map(k => ({
      chargeType: k,
      invoiceCount: b.invoiceCount[k],
      opening: round2(openingByKey[k]),
      broughtForward: round2(b.broughtForward[k]),
      billed: round2(b.billed[k]),
      adjustments: round2(b.adjustments[k]),
      received: round2(b.received[k]),
      closing: round2(openingByKey[k] + movement(b, k))
    }));
    const totals = {
      invoiceCount: sumKeys(b.invoiceCount),
      opening: round2(sumKeys(openingByKey)),
      broughtForward: round2(sumKeys(b.broughtForward)),
      billed: round2(sumKeys(b.billed)),
      adjustments: round2(sumKeys(b.adjustments)),
      received: round2(sumKeys(b.received))
    };
    totals.closing = round2(totals.opening + totals.broughtForward + totals.billed + totals.adjustments - totals.received);
    const nextOpening = emptyKeys();
    keys.forEach(k => { nextOpening[k] = openingByKey[k] + movement(b, k); });
    openingByKey = nextOpening;
    return { month: m, monthLabel: monthLabel(m), rows, totals };
  });

  // Whole range: opening of first month, sums, closing of last month
  const rangeRows = keys.map(k => {
    const pick = (mr) => mr.rows.find(r => r.chargeType === k);
    const sum = (field) => round2(monthRows.reduce((s, mr) => s + pick(mr)[field], 0));
    return {
      chargeType: k,
      invoiceCount: monthRows.reduce((s, mr) => s + pick(mr).invoiceCount, 0),
      opening: pick(monthRows[0]).opening,
      broughtForward: sum('broughtForward'),
      billed: sum('billed'),
      adjustments: sum('adjustments'),
      received: sum('received'),
      closing: pick(monthRows[monthRows.length - 1]).closing
    };
  });
  const rangeTotals = ['invoiceCount', 'opening', 'broughtForward', 'billed', 'adjustments', 'received', 'closing']
    .reduce((acc, f) => ({ ...acc, [f]: round2(rangeRows.reduce((s, r) => s + r[f], 0)) }), {});

  // Bank side (same as Deposits page): deposits + suspense by deposit date
  const bank = {};
  months.forEach(m => { bank[m] = { deposits: 0, suspense: 0, bankTotal: 0, billPaymentTransactions: 0, billPaymentsNotOnABill: 0 }; });
  bankAgg.deposits.forEach(r => {
    const b = bank[r._id.m];
    if (!b) return;
    if (r._id.suspense) b.suspense += r.amount; else b.deposits += r.amount;
    b.bankTotal += r.amount;
  });
  bankAgg.billPayments.forEach(r => {
    const b = bank[r._id.m];
    if (!b) return;
    b.billPaymentTransactions += r.amount;
    if (!r._id.linked) b.billPaymentsNotOnABill += r.amount;
  });
  Object.values(bank).forEach(b => Object.keys(b).forEach(f => { b[f] = round2(b[f]); }));
  monthRows.forEach(mr => { mr.bank = bank[mr.month]; });

  const receivableNow = allTime.broughtForward + allTime.billed + allTime.adjustments - allTime.received;
  const check = { receivableAsOfToday: round2(receivableNow) };
  if (ledger) {
    check.residentLedgerTotal = round2(ledger.ledgerTotal);
    check.ledgerLatePaymentSurchargeNotOnBills = round2(ledger.surchargeNotOnBills);
    check.paidAboveBill = round2(ledger.paidAboveBill);
    check.difference = round2(ledger.ledgerTotal - receivableNow);
    // What summing stored invoice balances gives (carried arrears counted again on every later bill)
    check.storedInvoiceBalanceSum = round2(ledger.storedBalanceSum);
  }

  const data = {
    timezone,
    startMonth: fromMonth,
    endMonth: toMonth,
    chargeTypes: keys,
    range: { rows: rangeRows, totals: rangeTotals },
    months: monthRows,
    check,
    quality: {
      paymentsWithoutDate: quality.paymentsWithoutDate,
      receivedAfterRange: round2(quality.receivedAfterRange),
      billedWithoutMonth: round2(quality.billedWithoutMonth)
    },
    generatedAt: new Date().toISOString()
  };
  setCached(cacheKey, data);
  return { ...data, cached: false };
};

module.exports = {
  CHARGE_KEYS,
  chargeKey,
  buildReceivableRollForward,
  ledgerInvoiceDisplayAmount,
  ledgerSectionKey,
  ledgerPeriodKey,
  ledgerOutstandingRows
};
