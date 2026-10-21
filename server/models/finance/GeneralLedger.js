const mongoose = require('mongoose');

const generalLedgerSchema = new mongoose.Schema({
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'PlacementCompany',
    index: true,
    default: null
  },
  // Reference to journal entry
  journalEntry: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'JournalEntry',
    required: [true, 'Journal entry reference is required']
  },
  // Account information
  account: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Account',
    required: [true, 'Account reference is required']
  },
  // Transaction details
  date: {
    type: Date,
    required: [true, 'Transaction date is required']
  },
  entryNumber: {
    type: String,
    required: [true, 'Entry number is required']
  },
  reference: {
    type: String,
    trim: true
  },
  description: {
    type: String,
    required: [true, 'Description is required'],
    trim: true
  },
  // Amounts
  debit: {
    type: Number,
    default: 0,
    min: [0, 'Debit amount cannot be negative'],
    get: function(val) {
      return Math.round(val * 100) / 100;
    },
    set: function(val) {
      return Math.round(val * 100) / 100;
    }
  },
  credit: {
    type: Number,
    default: 0,
    min: [0, 'Credit amount cannot be negative'],
    get: function(val) {
      return Math.round(val * 100) / 100;
    },
    set: function(val) {
      return Math.round(val * 100) / 100;
    }
  },
  runningBalance: {
    type: Number,
    default: 0,
    get: function(val) {
      return Math.round(val * 100) / 100;
    },
    set: function(val) {
      return Math.round(val * 100) / 100;
    }
  },
  // Department and module tracking
  department: {
    type: String,
    trim: true,
    required: [true, 'Department is required']
  },
  module: {
    type: String,
    trim: true,
    required: [true, 'Module is required']
  },
  referenceId: {
    type: mongoose.Schema.Types.ObjectId
  },
  referenceType: {
    type: String,
    enum: ['payroll', 'invoice', 'bill', 'payment', 'receipt', 'adjustment', 'manual', 'grn', 'sin', 'purchase_order', 'stock_adjustment', 'purchase_return', 'depreciation', 'expense'],
    default: 'manual'
  },
  // Analytic / cost-center tag — enables cost-center P&L
  costCenter: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'FinanceCostCenter'
  },
  partyType: {
    type: String,
    enum: ['Vendor', 'Customer', 'Employee', 'Company'],
    default: undefined,
    set: v => (v === '' || v === null) ? undefined : v
  },
  party: {
    type: mongoose.Schema.Types.ObjectId,
    refPath: 'partyType',
    default: undefined,
    set: v => (v === '' || v === null) ? undefined : v
  },
  // Status
  status: {
    type: String,
    enum: ['posted', 'reversed', 'cancelled'],
    default: 'posted'
  },
  // Clearance and Bank Reconciliation status
  clearanceStatus: {
    type: String,
    enum: ['pending', 'cleared'],
    default: 'pending'
  },
  clearedAt: {
    type: Date,
    default: null
  },
  isReconciled: {
    type: Boolean,
    default: false
  },
  reconciledAt: {
    type: Date,
    default: null
  },
  // Audit trail
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Created by user is required']
  },
  postedDate: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Indexes for efficient querying
generalLedgerSchema.index({ account: 1, date: 1 });
generalLedgerSchema.index({ date: 1 });
generalLedgerSchema.index({ entryNumber: 1 });
generalLedgerSchema.index({ department: 1 });
generalLedgerSchema.index({ module: 1 });
generalLedgerSchema.index({ referenceId: 1 });
generalLedgerSchema.index({ status: 1 });

// Virtual for formatted amounts
generalLedgerSchema.virtual('formattedDebit').get(function() {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD'
  }).format(this.debit);
});

generalLedgerSchema.virtual('formattedCredit').get(function() {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD'
  }).format(this.credit);
});

generalLedgerSchema.virtual('formattedBalance').get(function() {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD'
  }).format(this.runningBalance);
});

/**
 * When GeneralLedger rows are missing (legacy flows, failed insert, etc.), build the
 * account ledger from posted JournalEntry lines — same economic source as trial-balance-v2.
 * Optional companyId keeps the ledger aligned with company-filtered Trial Balance.
 */
generalLedgerSchema.statics.buildLedgerRowsFromJournalEntries = async function(accountId, startDate, endDate, companyId = null) {
  const JournalEntry = require('./JournalEntry');
  const accOid = mongoose.Types.ObjectId.isValid(String(accountId))
    ? new mongoose.Types.ObjectId(String(accountId))
    : accountId;

  const jeMatch = { status: 'posted' };
  if (companyId && mongoose.Types.ObjectId.isValid(String(companyId))) {
    jeMatch.companyId = new mongoose.Types.ObjectId(String(companyId));
  }
  if (startDate || endDate) {
    jeMatch.date = {};
    if (startDate) jeMatch.date.$gte = startDate;
    if (endDate) jeMatch.date.$lte = endDate;
  }

  const rows = await JournalEntry.aggregate([
    { $match: jeMatch },
    { $unwind: '$lines' },
    { $match: { 'lines.account': accOid } },
    { $sort: { date: 1, entryNumber: 1 } },
    {
      $project: {
        _id: {
          $concat: [
            { $toString: '$_id' },
            ':',
            { $toString: { $ifNull: ['$lines._id', '0'] } }
          ]
        },
        date: 1,
        entryNumber: 1,
        reference: 1,
        description: { $ifNull: ['$lines.description', '$description'] },
        debit: '$lines.debit',
        credit: '$lines.credit',
        department: { $ifNull: ['$lines.department', '$department'] },
        project: '$project',
        partyType: '$lines.partyType',
        party: '$lines.party',
        module: 1,
        referenceId: '$referenceId',
        referenceType: '$referenceType',
        createdBy: '$createdBy',
        journalEntry: {
          _id: '$_id',
          entryNumber: '$entryNumber',
          reference: '$reference',
          description: '$description'
        }
      }
    }
  ]);

  const { enrichPartyFields, enrichDepartmentFields } = require('../../utils/financePartyResolve');
  await enrichPartyFields(rows);
  await enrichDepartmentFields(rows, 'department');
  return rows;
};

// Static methods for ledger operations
/**
 * Net movement (debit - credit) for an account before a date.
 * Always JE-dated — same rule as trial-balance-v2 Opening (do not use GL.date).
 */
generalLedgerSchema.statics.getAccountOpeningBalance = async function(accountId, beforeDate, companyId = null) {
  if (!beforeDate) return 0;
  const accOid = mongoose.Types.ObjectId.isValid(String(accountId))
    ? new mongoose.Types.ObjectId(String(accountId))
    : accountId;

  const JournalEntry = require('./JournalEntry');
  const jeMatch = {
    status: 'posted',
    date: { $lt: beforeDate }
  };
  if (companyId && mongoose.Types.ObjectId.isValid(String(companyId))) {
    jeMatch.companyId = new mongoose.Types.ObjectId(String(companyId));
  }
  const jeAgg = await JournalEntry.aggregate([
    { $match: jeMatch },
    { $unwind: '$lines' },
    { $match: { 'lines.account': accOid } },
    {
      $group: {
        _id: null,
        net: {
          $sum: {
            $subtract: [{ $ifNull: ['$lines.debit', 0] }, { $ifNull: ['$lines.credit', 0] }]
          }
        }
      }
    }
  ]);
  return Math.round((Number(jeAgg[0]?.net) || 0) * 100) / 100;
};

const moneyEqGl = (a, b) => Math.abs(Number(a || 0) - Number(b || 0)) < 0.02;

/**
 * Attach real GL row id(s) + clearance onto JE-sourced ledger rows so BR can clear.
 * Exact debit/credit match preferred; if several installment GLs sum to the JE line, link all.
 */
generalLedgerSchema.statics.attachGlClearanceToJeLedgerRows = async function(entries, accountId) {
  if (!Array.isArray(entries) || !entries.length) return entries || [];
  const accOid = mongoose.Types.ObjectId.isValid(String(accountId))
    ? new mongoose.Types.ObjectId(String(accountId))
    : accountId;

  const jeIds = [
    ...new Set(
      entries
        .map((e) => String(e.journalEntry?._id || e.journalEntry || ''))
        .filter((id) => mongoose.Types.ObjectId.isValid(id))
    )
  ];
  if (!jeIds.length) return entries;

  const glRows = await this.find({
    account: accOid,
    status: 'posted',
    journalEntry: { $in: jeIds }
  })
    .select('_id journalEntry debit credit clearanceStatus clearedAt isReconciled reconciledAt date')
    .lean();

  const byJe = new Map();
  for (const g of glRows) {
    const jid = String(g.journalEntry);
    if (!byJe.has(jid)) byJe.set(jid, []);
    byJe.get(jid).push(g);
  }

  const resolveClearanceAggregate = (linked) => {
    if (!linked.length) {
      return {
        clearanceStatus: 'pending',
        clearedAt: null,
        isReconciled: false,
        reconciledAt: null
      };
    }
    const allCleared = linked.every(
      (g) => g.clearanceStatus === 'cleared' || g.isReconciled === true
    );
    if (!allCleared) {
      return {
        clearanceStatus: 'pending',
        clearedAt: null,
        isReconciled: false,
        reconciledAt: null
      };
    }
    const times = linked
      .map((g) => g.clearedAt || g.reconciledAt)
      .filter(Boolean)
      .map((d) => new Date(d).getTime())
      .filter((t) => !Number.isNaN(t));
    const latest = times.length ? new Date(Math.max(...times)) : null;
    return {
      clearanceStatus: 'cleared',
      clearedAt: latest,
      isReconciled: true,
      reconciledAt: latest
    };
  };

  for (const row of entries) {
    const jid = String(row.journalEntry?._id || row.journalEntry || '');
    const candidates = byJe.get(jid) || [];
    const debit = Number(row.debit) || 0;
    const credit = Number(row.credit) || 0;

    let linked = candidates.filter(
      (g) => moneyEqGl(g.debit, debit) && moneyEqGl(g.credit, credit)
    );

    // Installment GLs: same side, amounts sum to JE line (GL.date may differ from JE.date)
    if (!linked.length && candidates.length > 1) {
      if (credit > 0) {
        const credits = candidates.filter((g) => Number(g.credit) > 0 && Number(g.debit) === 0);
        const sum = credits.reduce((s, g) => s + (Number(g.credit) || 0), 0);
        if (credits.length > 1 && moneyEqGl(sum, credit)) linked = credits;
      } else if (debit > 0) {
        const debits = candidates.filter((g) => Number(g.debit) > 0 && Number(g.credit) === 0);
        const sum = debits.reduce((s, g) => s + (Number(g.debit) || 0), 0);
        if (debits.length > 1 && moneyEqGl(sum, debit)) linked = debits;
      }
    }

    // Single leftover GL on this JE+account for this side
    if (!linked.length && candidates.length === 1) {
      const g = candidates[0];
      if (
        (credit > 0 && Number(g.credit) > 0) ||
        (debit > 0 && Number(g.debit) > 0)
      ) {
        // Only if amounts match — otherwise leave synthetic id (reconcile may create)
        if (moneyEqGl(g.debit, debit) && moneyEqGl(g.credit, credit)) linked = [g];
      }
    }

    const clearance = resolveClearanceAggregate(linked);
    row.linkedGlIds = linked.map((g) => String(g._id));
    if (linked.length === 1) {
      row._id = linked[0]._id;
    } else if (linked.length > 1) {
      // Prefer a real ObjectId so BR clearance lookup works; clear updates all linkedGlIds
      row._id = linked[0]._id;
    }
    row.clearanceStatus = clearance.clearanceStatus;
    row.clearedAt = clearance.clearedAt;
    row.isReconciled = clearance.isReconciled;
    row.reconciledAt = clearance.reconciledAt;
    // Keep JE.date for period membership (TB-aligned); do not overwrite with GL.date
  }

  return entries;
};

/**
 * Account ledger for a date window — same period membership as trial-balance-v2:
 * posted JournalEntry.date in [start, end], not GeneralLedger.date.
 * Real GL ids / clearance are attached for bank reconciliation.
 */
generalLedgerSchema.statics.getAccountLedger = async function(accountId, startDate, endDate, companyId = null) {
  const accOid = mongoose.Types.ObjectId.isValid(String(accountId))
    ? new mongoose.Types.ObjectId(String(accountId))
    : accountId;

  let entries = await this.buildLedgerRowsFromJournalEntries(accOid, startDate, endDate, companyId);
  entries = await this.attachGlClearanceToJeLedgerRows(entries, accOid);

  // Populate project names when present as ids
  const projectIds = [
    ...new Set(
      entries
        .map((r) => r.project)
        .filter((p) => p && !(typeof p === 'object' && p.name))
        .map((p) => String(p._id || p))
        .filter((id) => mongoose.Types.ObjectId.isValid(id))
    )
  ];
  if (projectIds.length) {
    try {
      const Project = mongoose.model('Project');
      const projects = await Project.find({ _id: { $in: projectIds } }).select('name code').lean();
      const pmap = new Map(projects.map((p) => [String(p._id), p]));
      for (const row of entries) {
        const pid = row.project ? String(row.project._id || row.project) : '';
        if (pid && pmap.has(pid)) row.project = pmap.get(pid);
      }
    } catch (_) {
      /* Project model optional */
    }
  }

  const Account = mongoose.model('Account');
  const accDoc = await Account.findById(accOid).select('accountNumber name type').lean();
  if (accDoc) {
    entries.forEach((entry) => {
      if (!entry.account || typeof entry.account !== 'object' || !entry.account.accountNumber) {
        entry.account = accDoc;
      }
    });
  }

  const openingBalance = startDate
    ? await this.getAccountOpeningBalance(accOid, startDate, companyId)
    : 0;

  let runningBalance = Math.round((Number(openingBalance) || 0) * 100) / 100;
  entries.forEach((entry) => {
    runningBalance = Math.round(
      (runningBalance + (Number(entry.debit) || 0) - (Number(entry.credit) || 0)) * 100
    ) / 100;
    entry.runningBalance = runningBalance;
  });

  return {
    entries,
    openingBalance,
    closingBalance: runningBalance
  };
};

generalLedgerSchema.statics.getGeneralLedger = async function(filters = {}) {
  const query = { status: 'posted', ...filters };
  
  const entries = await this.find(query)
    .populate('journalEntry', 'entryNumber reference description department module')
    .populate('account', 'accountNumber name type category')
    .populate('createdBy', 'firstName lastName')
    .sort({ date: 1, entryNumber: 1 });

  return entries;
};

generalLedgerSchema.statics.getDepartmentLedger = async function(department, startDate, endDate) {
  const query = {
    department,
    status: 'posted'
  };

  if (startDate || endDate) {
    query.date = {};
    if (startDate) query.date.$gte = startDate;
    if (endDate) query.date.$lte = endDate;
  }

  return this.find(query)
    .populate('journalEntry', 'entryNumber reference description')
    .populate('account', 'accountNumber name type category')
    .populate('createdBy', 'firstName lastName')
    .sort({ date: 1, entryNumber: 1 });
};

generalLedgerSchema.statics.getModuleLedger = async function(module, startDate, endDate) {
  const query = {
    module,
    status: 'posted'
  };

  if (startDate || endDate) {
    query.date = {};
    if (startDate) query.date.$gte = startDate;
    if (endDate) query.date.$lte = endDate;
  }

  return this.find(query)
    .populate('journalEntry', 'entryNumber reference description')
    .populate('account', 'accountNumber name type category')
    .populate('createdBy', 'firstName lastName')
    .sort({ date: 1, entryNumber: 1 });
};

generalLedgerSchema.statics.getAccountBalance = async function(accountId, asOfDate = new Date()) {
  const entry = await this.findOne({
    account: accountId,
    status: 'posted',
    date: { $lte: asOfDate }
  }).sort({ date: -1, createdAt: -1 });

  return entry ? entry.runningBalance : 0;
};

generalLedgerSchema.statics.getAccountSummary = async function(accountId, startDate, endDate) {
  const pipeline = [
    {
      $match: {
        account: mongoose.Types.ObjectId(accountId),
        status: 'posted'
      }
    }
  ];

  if (startDate || endDate) {
    const dateMatch = {};
    if (startDate) dateMatch.$gte = startDate;
    if (endDate) dateMatch.$lte = endDate;
    pipeline[0].$match.date = dateMatch;
  }

  pipeline.push(
    {
      $group: {
        _id: '$account',
        totalDebits: { $sum: '$debit' },
        totalCredits: { $sum: '$credit' },
        transactionCount: { $sum: 1 },
        firstTransaction: { $min: '$date' },
        lastTransaction: { $max: '$date' }
      }
    },
    {
      $lookup: {
        from: 'accounts',
        localField: '_id',
        foreignField: '_id',
        as: 'account'
      }
    },
    {
      $unwind: '$account'
    }
  );

  const result = await this.aggregate(pipeline);
  return result[0] || null;
};

// Method to create ledger entry from journal entry line
generalLedgerSchema.statics.createFromJournalEntry = async function(journalEntry, line, account) {
  const Account = mongoose.model('Account');
  
  // Get current balance for running balance calculation
  const currentBalance = await this.getAccountBalance(account._id, journalEntry.date);
  
  const ledgerEntry = new this({
    journalEntry: journalEntry._id,
    account: account._id,
    date: journalEntry.date,
    entryNumber: journalEntry.entryNumber,
    reference: journalEntry.reference,
    description: line.description || journalEntry.description,
    debit: line.debit,
    credit: line.credit,
    runningBalance: currentBalance + (line.debit - line.credit),
    department: journalEntry.department,
    module: journalEntry.module,
    referenceId: journalEntry.referenceId,
    referenceType: journalEntry.referenceType,
    createdBy: journalEntry.createdBy,
    postedDate: journalEntry.postedDate
  });

  return ledgerEntry.save();
};

module.exports = mongoose.model('GeneralLedger', generalLedgerSchema);
