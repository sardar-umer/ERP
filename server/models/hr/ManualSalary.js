const mongoose = require('mongoose');

const manualSalarySchema = new mongoose.Schema({
  month: {
    type: Number,
    required: true,
    min: 1,
    max: 12
  },
  year: {
    type: Number,
    required: true
  },
  empId: {
    type: String,
    trim: true,
    default: ''
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  designation: {
    type: String,
    trim: true,
    default: ''
  },
  project: {
    type: String,
    trim: true,
    default: ''
  },
  // Company whose name is printed on the salary and whose books Finance pays it from
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'PlacementCompany',
    index: true
  },
  companyName: {
    type: String,
    trim: true,
    default: ''
  },
  doj: {
    type: String,
    trim: true,
    default: ''
  },
  basicSalary: {
    type: Number,
    default: 0
  },
  foodAllowance: {
    type: Number,
    default: 0
  },
  houseRentAllowance: {
    type: Number,
    default: 0
  },
  medicalAllowance: {
    type: Number,
    default: 0
  },
  conveyanceAllowance: {
    type: Number,
    default: 0
  },
  vehicleAllowance: {
    type: Number,
    default: 0
  },
  fuelAllowance: {
    type: Number,
    default: 0
  },
  specialAllowance: {
    type: Number,
    default: 0
  },
  otherAllowance: {
    type: Number,
    default: 0
  },
  grossSalary: {
    type: Number,
    default: 0
  },
  incomeTax: {
    type: Number,
    default: 0
  },
  netPayable: {
    type: Number,
    default: 0
  },
  remarks: {
    type: String,
    trim: true,
    default: ''
  },

  // Workflow (same pattern as New-Hiring Approval, without Chairman / Sr Director)
  workflowStatus: {
    type: String,
    enum: [
      'Draft',
      'Pending HOD HR',
      'Pending AVP',
      'Forwarded to CEO',
      'Approved by CEO',
      'Pending Audit',
      'Forwarded to Audit Director',
      'Pending Finance',
      'Payment Pending',
      'Paid',
      'Rejected by CEO',
      'Returned'
    ],
    default: 'Pending HOD HR',
    index: true
  },
  initiator: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  initiatedAt: { type: Date, default: Date.now },
  requesterSignature: { type: String },

  assignedHod: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  hodApprovedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  hodApprovedAt: { type: Date },
  hodComments: { type: String },
  hodSignature: { type: String },

  assignedAvp: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  avpApprovedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  avpApprovedAt: { type: Date },
  avpComments: { type: String },
  avpSignature: { type: String },

  ceoApprovedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  ceoApprovedAt: { type: Date },
  ceoComments: { type: String },
  ceoSignature: { type: String },

  rejectionComments: { type: String },
  returnComments: { type: String },
  returnedFromStatus: { type: String },

  // Audit (after AVP): pre-audit staff initial approval → forward → Audit Director final approval → Finance
  preAuditInitialApprovedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  preAuditInitialApprovedAt: { type: Date },
  preAuditInitialComments: { type: String },
  auditForwardedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  auditForwardedAt: { type: Date },
  auditApprovedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  auditApprovedAt: { type: Date },
  auditComments: { type: String },
  auditObservations: [{
    observation: { type: String, trim: true },
    severity: { type: String, enum: ['low', 'medium', 'high', 'critical'], default: 'medium' },
    addedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    addedAt: { type: Date, default: Date.now }
  }],
  workflowHistory: [{
    fromStatus: String,
    toStatus: String,
    changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    changedAt: { type: Date, default: Date.now },
    comments: String,
    module: String
  }],

  // Finance payment
  paymentApplicationId: { type: mongoose.Schema.Types.ObjectId, ref: 'ManualSalaryPaymentApplication' },
  paymentJournalEntryId: { type: mongoose.Schema.Types.ObjectId, ref: 'JournalEntry' },
  paidAt: { type: Date },
  paidBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, {
  timestamps: true
});

module.exports = mongoose.model('ManualSalary', manualSalarySchema);
