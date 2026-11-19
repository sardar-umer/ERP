const mongoose = require('mongoose');

/**
 * Lump-sum loan payment request: HR raises it, Finance confirms the money and posts the
 * receipt voucher. Only when the voucher is posted does the loan schedule change.
 *
 * Pending Finance → Posted (voucher created, schedule rebuilt)
 *                 → Returned (back to HR with comments; HR can edit and resubmit)
 *                 → Rejected (final)
 *                 → Cancelled (HR withdrew it)
 * Posted → Reversed (Finance deleted/reversed the voucher; loan restored)
 */
const STATUSES = ['Pending Finance', 'Posting', 'Posted', 'Returned', 'Rejected', 'Cancelled', 'Reversed'];

const loanLumpSumRequestSchema = new mongoose.Schema({
  requestNumber: { type: String, trim: true, index: true },
  loan: { type: mongoose.Schema.Types.ObjectId, ref: 'Loan', required: true, index: true },
  employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },

  amount: { type: Number, required: true, min: [1, 'Amount must be greater than zero'] },
  mode: { type: String, enum: ['reduce_tenure', 'reduce_installment'], default: 'reduce_tenure' },
  paymentDate: { type: Date, required: true },
  paymentMethod: {
    type: String,
    enum: ['Cash', 'Bank Transfer', 'Cheque', 'Direct Payment'],
    default: 'Cash'
  },
  reference: { type: String, trim: true, maxlength: 100 },
  remarks: { type: String, trim: true, maxlength: 500 },

  /** What HR saw when submitting (Finance re-calculates at posting time) */
  previewAtRequest: { type: mongoose.Schema.Types.Mixed },

  status: { type: String, enum: STATUSES, default: 'Pending Finance', index: true },

  requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  requestedAt: { type: Date, default: Date.now },

  financeComments: { type: String, trim: true, maxlength: 500 },
  processedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  processedAt: { type: Date },

  /** Set when posted */
  companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'PlacementCompany' },
  receivedInAccount: { type: mongoose.Schema.Types.ObjectId, ref: 'Account' },
  journalEntry: { type: mongoose.Schema.Types.ObjectId, ref: 'JournalEntry', index: true },
  voucherNumber: { type: String, trim: true },
  /** _id of the entry pushed into loan.payments */
  loanPaymentId: { type: mongoose.Schema.Types.ObjectId },
  /** Result of the reschedule at posting (before/after) */
  postingResult: { type: mongoose.Schema.Types.Mixed },
  /** Loan fields before posting — restored if the voucher is reversed/deleted */
  loanSnapshot: { type: mongoose.Schema.Types.Mixed },

  reversedAt: { type: Date },
  reversedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  reversalNote: { type: String, trim: true, maxlength: 500 },

  history: [{
    action: { type: String, trim: true },
    by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    at: { type: Date, default: Date.now },
    comments: { type: String, trim: true, maxlength: 500 }
  }]
}, { timestamps: true });

loanLumpSumRequestSchema.index({ status: 1, requestedAt: -1 });

loanLumpSumRequestSchema.pre('save', function (next) {
  if (!this.requestNumber) {
    this.requestNumber = `LSR-${String(this._id).slice(-6).toUpperCase()}`;
  }
  next();
});

loanLumpSumRequestSchema.statics.STATUSES = STATUSES;
loanLumpSumRequestSchema.statics.OPEN_STATUSES = ['Pending Finance', 'Posting'];

module.exports = mongoose.model('LoanLumpSumRequest', loanLumpSumRequestSchema);
