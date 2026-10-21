const mongoose = require('mongoose');

const employeeLineSchema = new mongoose.Schema({
  /** Full name (memo: Name) */
  name: { type: String, trim: true, default: '' },
  /** CNIC / Passport No. */
  cnic: { type: String, trim: true, default: '' },
  designation: { type: String, trim: true, default: '' },
  /** Department / Subject */
  departmentSubject: { type: String, trim: true, default: '' },
  project: { type: String, trim: true, default: '' },
  location: { type: String, trim: true, default: '' },
  /** Current Package Monthly — free text (numbers and/or words, e.g. "80,000" or "As per negotiation") */
  currentPackageMonthly: { type: String, trim: true, default: '' },
  /** Tentative Date of Joining */
  tentativeDoj: { type: Date, default: null },
  remark: { type: String, trim: true, default: '' },

  // Legacy fields kept optional so old documents still load without a new collection
  firstName: { type: String, trim: true },
  lastName: { type: String, trim: true },
  phone: { type: String, trim: true },
  address: { type: String, trim: true },
  role: { type: String, trim: true },
  expectedWages: { type: Number },
  justification: { type: String, trim: true }
}, { _id: false });

const nonEmployeeRecordSchema = new mongoose.Schema({
  recordNumber: { type: String, unique: true },
  employees: {
    type: [employeeLineSchema],
    validate: {
      validator: (v) => Array.isArray(v) && v.length > 0,
      message: 'At least one candidate is required'
    }
  },

  // Workflow tracking
  workflowStatus: {
    type: String,
    enum: [
      'Draft',
      'Pending HOD HR',
      'Pending Sr Director',
      'Pending AVP',
      'Pending Chairman',
      'Forwarded to CEO',
      'Approved by CEO',
      'Rejected by CEO',
      'Returned'
    ],
    default: 'Pending HOD HR'
  },

  initiator: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  initiatedAt: { type: Date, default: Date.now },
  requesterSignature: { type: String },
  assignedHod: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

  hodApprovedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  hodApprovedAt: { type: Date },
  hodComments: { type: String },
  hodSignature: { type: String },

  assignedSrDirector: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  srDirectorApprovedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  srDirectorApprovedAt: { type: Date },
  srDirectorComments: { type: String },
  srDirectorSignature: { type: String },

  assignedAvp: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  avpApprovedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  avpApprovedAt: { type: Date },
  avpComments: { type: String },
  avpSignature: { type: String },

  assignedChairman: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  chairmanApprovedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  chairmanApprovedAt: { type: Date },
  chairmanComments: { type: String },
  chairmanSignature: { type: String },

  ceoApprovedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  ceoApprovedAt: { type: Date },
  ceoComments: { type: String },
  ceoSignature: { type: String },

  rejectionComments: { type: String },
  returnComments: { type: String },
  /** Structured observations from return/reject (shown to initiator). */
  returnObservations: [{
    observation: { type: String, trim: true },
    severity: {
      type: String,
      enum: ['low', 'medium', 'high', 'critical'],
      default: 'medium'
    },
    addedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    addedAt: { type: Date, default: Date.now },
    resolved: { type: Boolean, default: false }
  }],
  /** Who returned/rejected the record most recently (cleared on resubmit). */
  returnedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  returnedAt: { type: Date },
  /**
   * One entry per return → resubmit cycle: what the authority said and how the
   * initiator responded (overall comment + per-observation response).
   */
  resubmissionHistory: [{
    returnedFromStatus: { type: String, trim: true },
    returnedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    returnedByName: { type: String, trim: true },
    returnedAt: { type: Date },
    returnComments: { type: String, trim: true },
    observations: [{
      observation: { type: String, trim: true },
      severity: { type: String, trim: true },
      response: { type: String, trim: true, default: '' }
    }],
    initiatorComment: { type: String, trim: true },
    resubmittedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    resubmittedByName: { type: String, trim: true },
    resubmittedAt: { type: Date, default: Date.now },
    resubmittedTo: { type: String, trim: true }
  }],
  /**
   * Stage that rejected/returned the record so resubmit goes back there
   * (e.g. 'Pending AVP'), not a fresh HOD cycle.
   */
  returnedFromStatus: {
    type: String,
    enum: [
      'Pending HOD HR',
      'Pending AVP',
      'Pending Chairman',
      'Pending Sr Director',
      'Forwarded to CEO'
    ]
  },

  // Attachments (e.g. CNIC copy, photo)
  attachments: [{
    filename: String,
    originalName: String,
    url: String,
    uploadedAt: { type: Date, default: Date.now }
  }],
}, { timestamps: true });

/** Normalize legacy employee rows → memo columns (same collection, no new table). */
nonEmployeeRecordSchema.statics.normalizeEmployeeLine = (raw = {}) => {
  const name = String(raw.name || '').trim()
    || [raw.firstName, raw.lastName].filter(Boolean).join(' ').trim();
  const designation = String(raw.designation || raw.role || '').trim();
  const packageRaw = raw.currentPackageMonthly != null && String(raw.currentPackageMonthly).trim() !== ''
    ? String(raw.currentPackageMonthly).trim()
    : (raw.expectedWages != null && String(raw.expectedWages).trim() !== ''
      ? String(raw.expectedWages).trim()
      : '');
  let tentativeDoj = raw.tentativeDoj || null;
  if (tentativeDoj && !(tentativeDoj instanceof Date)) {
    const d = new Date(tentativeDoj);
    tentativeDoj = Number.isNaN(d.getTime()) ? null : d;
  }

  return {
    name,
    cnic: String(raw.cnic || raw.cnicPassport || '').trim(),
    designation,
    departmentSubject: String(raw.departmentSubject || raw.department || '').trim(),
    project: String(raw.project || '').trim(),
    location: String(raw.location || '').trim(),
    currentPackageMonthly: packageRaw,
    tentativeDoj,
    remark: String(raw.remark || raw.justification || '').trim()
  };
};

nonEmployeeRecordSchema.pre('validate', function (next) {
  if (Array.isArray(this.employees)) {
    this.employees = this.employees.map((e) => this.constructor.normalizeEmployeeLine(e));
  }
  next();
});

// Auto-generate recordNumber before saving
nonEmployeeRecordSchema.pre('save', async function (next) {
  if (this.isNew && !this.recordNumber) {
    try {
      const lastRecord = await this.constructor.findOne({}, 'recordNumber').sort({ createdAt: -1 });
      let nextNum = 1;
      if (lastRecord && lastRecord.recordNumber) {
        const parts = lastRecord.recordNumber.split('-');
        if (parts.length > 1) {
          nextNum = parseInt(parts[1], 10) + 1;
        }
      }
      this.recordNumber = `NE-${nextNum.toString().padStart(4, '0')}`;
    } catch (err) {
      return next(err);
    }
  }
  next();
});

module.exports = mongoose.model('NonEmployeeRecord', nonEmployeeRecordSchema);
