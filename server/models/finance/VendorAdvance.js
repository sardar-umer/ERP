const mongoose = require('mongoose');

const vendorAdvanceSchema = new mongoose.Schema({
  vendor: {
    name: { type: String, required: true, trim: true },
    email: { type: String, trim: true, lowercase: true },
    vendorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Vendor' }
  },
  amount: { type: Number, required: true, min: 0 },
  appliedAmount: { type: Number, default: 0, min: 0 },
  // Track how much of this advance was applied against which AP bills.
  // This is used to display a proper “partial advance applied” history.
  allocations: [
    {
      billId: { type: mongoose.Schema.Types.ObjectId, default: null },
      billNumber: { type: String, default: '' },
      amount: { type: Number, default: 0, min: 0 },
      appliedAt: { type: Date, default: Date.now }
    }
  ],
  categoryLines: [
    {
      account: { type: mongoose.Schema.Types.ObjectId, ref: 'Account' },
      accountNumber: { type: String, trim: true },
      description: { type: String, trim: true },
      amount: { type: Number, min: 0 },
      project: { type: String, trim: true }
    }
  ],
  paymentMethod: {
    type: String,
    enum: ['cash', 'check', 'cheque', 'credit_card', 'bank_transfer', 'bank', 'ach', 'other'],
    default: 'bank_transfer'
  },
  /** Finance cost center the advance is charged to (copied onto its voucher(s), like bill payments) */
  costCenter: { type: mongoose.Schema.Types.ObjectId, ref: 'FinanceCostCenter', default: null },
  /** Chart-of-accounts bank or cash account credited on the vendor advance voucher */
  bankAccountId: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', default: null },
  reference: { type: String, trim: true },
  chequeNumber: { type: String, trim: true, index: { unique: true, sparse: true } },
  paymentDate: { type: Date, default: Date.now },
  department: {
    type: String,
    trim: true,
    default: 'procurement'
  },
  module: {
    type: String,
    trim: true,
    default: 'procurement'
  },
  referenceType: { type: String, default: 'advance' },
  referenceId: { type: mongoose.Schema.Types.ObjectId, default: null },
  /** Draft journal until all finance authorities approve (optional flow). */
  journalEntryId: { type: mongoose.Schema.Types.ObjectId, ref: 'JournalEntry', default: null },
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
  /** immediate = posted on save (legacy); pending_authority = draft JE; fully_approved = JE posted; rejected = cancelled */
  voucherWorkflowStatus: {
    type: String,
    enum: ['immediate', 'pending_authority', 'fully_approved', 'rejected'],
    default: 'immediate'
  },
  status: {
    type: String,
    enum: ['open', 'partially_applied', 'applied'],
    default: 'open'
  },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  /** Company that owns the PO / vendor advance (e.g. Taj Residencia) */
  companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'PlacementCompany', index: true },
  /** Company that pays the bank (may differ for intercompany advances) */
  payingCompanyId: { type: mongoose.Schema.Types.ObjectId, ref: 'PlacementCompany', index: true, default: null },
  /** Paying-company bank payment voucher when intercompany (separate from journalEntryId) */
  payingJournalEntryId: { type: mongoose.Schema.Types.ObjectId, ref: 'JournalEntry', default: null }
}, { timestamps: true });

vendorAdvanceSchema.virtual('remainingAmount').get(function() {
  return Math.round(((this.amount || 0) - (this.appliedAmount || 0)) * 100) / 100;
});

vendorAdvanceSchema.index({ companyId: 1, status: 1 });
vendorAdvanceSchema.index({ payingCompanyId: 1, status: 1 });
vendorAdvanceSchema.index({ 'vendor.vendorId': 1, status: 1, paymentDate: 1 });
vendorAdvanceSchema.index({ paymentDate: -1 });
vendorAdvanceSchema.index({ journalEntryId: 1 });
vendorAdvanceSchema.index({ payingJournalEntryId: 1 });

module.exports = mongoose.model('VendorAdvance', vendorAdvanceSchema);
