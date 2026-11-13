const mongoose = require('mongoose');

const apPaymentApplicationSchema = new mongoose.Schema({
  accountsPayableId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AccountsPayable',
    required: false,
    index: true
  },
  billNumber: { type: String, trim: true },
  bills: [{
    billId: { type: mongoose.Schema.Types.ObjectId, ref: 'AccountsPayable' },
    billNumber: { type: String, trim: true },
    amount: { type: Number, required: true, min: 0.01 }
  }],
  amount: { type: Number, required: true, min: 0.01 },
  sourceType: {
    type: String,
    enum: ['vendor_advance', 'cash_approval', 'bank_payment'],
    required: true
  },
  vendorAdvanceId: { type: mongoose.Schema.Types.ObjectId, ref: 'VendorAdvance', default: null },
  cashApprovalId: { type: mongoose.Schema.Types.ObjectId, ref: 'CashApproval', default: null },
  paymentMeta: {
    paymentMethod: { type: String },
    reference: { type: String, trim: true },
    batchId: { type: String, trim: true },
    whtRate: { type: Number, default: 0 },
    /** WHT withheld, as posted (entered directly, or worked out from the rate) */
    whtAmount: { type: Number, default: 0 },
    bankAccountId: { type: mongoose.Schema.Types.ObjectId, ref: 'Account' },
    relatedPartyAccountId: { type: mongoose.Schema.Types.ObjectId, ref: 'Account' },
    payingCompanyId: { type: mongoose.Schema.Types.ObjectId, ref: 'PlacementCompany' },
    allocations: [{ grnId: mongoose.Schema.Types.ObjectId, amount: Number }]
  },
  journalEntryId: { type: mongoose.Schema.Types.ObjectId, ref: 'JournalEntry', required: true, index: true },
  /** Paying-company bank voucher when intercompany (separate from journalEntryId on bill company) */
  payingJournalEntryId: { type: mongoose.Schema.Types.ObjectId, ref: 'JournalEntry', default: null, index: true },
  workflowStatus: {
    type: String,
    enum: ['pending_authority', 'fully_approved', 'rejected'],
    default: 'pending_authority',
    index: true
  },
  financeApprovalAuthorities: {
    accountsOfficerUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    accountsManagerUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    financeControllerUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  },
  financeAuthorityApprovals: [{
    authorityKey: { type: String, trim: true },
    authorityLabel: { type: String, trim: true },
    approver: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    decision: { type: String, enum: ['approved', 'rejected'], default: 'approved' },
    approvedAt: { type: Date, default: Date.now },
    comments: { type: String, trim: true }
  }],
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  finalizedAt: { type: Date, default: null }
}, { timestamps: true });

apPaymentApplicationSchema.index({ cashApprovalId: 1, workflowStatus: 1 });
apPaymentApplicationSchema.index({ vendorAdvanceId: 1, workflowStatus: 1 });

module.exports = mongoose.model('ApPaymentApplication', apPaymentApplicationSchema);
