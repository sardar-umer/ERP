const mongoose = require('mongoose');

/**
 * Fiscal Period — monthly accounting period.
 * Once a period is closed, no journal entry can be posted into it.
 * This protects finalized reports from retroactive changes.
 *
 * Status flow: open → closed → locked
 *   open   : Normal posting allowed
 *   closed : Period is closed; only finance managers can re-open
 *   locked : Audited; cannot be re-opened by anyone
 */
const fiscalPeriodSchema = new mongoose.Schema(
  {
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'PlacementCompany',
      index: true,
      default: null
    },
    name: {
      type: String,
      required: [true, 'Period name is required'],
      trim: true
    },
    year: {
      type: Number,
      required: [true, 'Fiscal year is required'],
      min: 2000,
      max: 2100
    },
    month: {
      type: Number,
      required: [true, 'Month is required'],
      min: 1,
      max: 12
    },
    startDate: {
      type: Date,
      required: [true, 'Start date is required']
    },
    endDate: {
      type: Date,
      required: [true, 'End date is required']
    },
    status: {
      type: String,
      enum: ['open', 'closed', 'locked'],
      default: 'open'
    },
    closedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    closedAt: Date,
    lockedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    lockedAt: Date,
    notes: {
      type: String,
      trim: true
    },
    // Closing entries reference (year-end P&L → Retained Earnings transfer)
    closingJournalEntry: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'JournalEntry'
    }
  },
  { timestamps: true }
);

// Each company + year/month combination must be unique
fiscalPeriodSchema.index({ companyId: 1, year: 1, month: 1 }, { unique: true });
fiscalPeriodSchema.index({ year: 1, month: 1 });
fiscalPeriodSchema.index({ status: 1 });
fiscalPeriodSchema.index({ startDate: 1, endDate: 1 });

/**
 * Check a posting date against the posting company's fiscal periods.
 * - Only that company's periods count (another company's closed month never blocks this one).
 * - Once a company has fiscal periods set up, a date with no period is refused (no posting into months
 *   that were never opened); closed / locked periods are refused.
 * - A company with no periods at all may still post (setup warning in Finance), unless
 *   FINANCE_REQUIRE_FISCAL_PERIODS=true makes periods mandatory everywhere.
 */
const periodError = (message) => Object.assign(new Error(message), { statusCode: 400 });

fiscalPeriodSchema.statics.validatePostingDate = async function (date, companyId = null) {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) throw periodError('Invalid posting date');
  const scope = companyId ? { companyId } : { $or: [{ companyId: null }, { companyId: { $exists: false } }] };

  const period = await this.findOne({ ...scope, startDate: { $lte: d }, endDate: { $gte: d } });
  if (!period) {
    const hasPeriods = await this.exists(scope);
    if (hasPeriods || String(process.env.FINANCE_REQUIRE_FISCAL_PERIODS).toLowerCase() === 'true') {
      throw periodError(`No fiscal period covers ${d.toISOString().slice(0, 10)} — open it in Finance → Fiscal Periods before posting`);
    }
    return null; // company has not set up fiscal periods yet
  }
  if (period.status === 'closed') {
    throw periodError(`Fiscal period ${period.name} is closed. Cannot post journal entries to a closed period.`);
  }
  if (period.status === 'locked') {
    throw periodError(`Fiscal period ${period.name} is locked. Contact your Finance Manager.`);
  }
  return period;
};

/**
 * Auto-generate fiscal periods for a full year.
 */
fiscalPeriodSchema.statics.generateYear = async function (year, createdBy, companyId = null) {
  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  const created = [];
  for (let m = 1; m <= 12; m++) {
    const startDate = new Date(year, m - 1, 1);
    const endDate = new Date(year, m, 0, 23, 59, 59);
    const existsQuery = { year, month: m };
    if (companyId) existsQuery.companyId = companyId;
    const exists = await this.findOne(existsQuery);
    if (!exists) {
      const period = await this.create({
        name: `${months[m - 1]} ${year}`,
        year,
        month: m,
        startDate,
        endDate,
        status: 'open',
        companyId: companyId || undefined,
        createdBy
      });
      created.push(period);
    }
  }
  return created;
};

module.exports = mongoose.model('FiscalPeriod', fiscalPeriodSchema);
