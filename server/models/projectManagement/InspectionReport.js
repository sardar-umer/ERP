const mongoose = require('mongoose');

/** Measured quantity per claimed BOQ line (BOQ-wise check requests only) */
const inspectionItemSchema = new mongoose.Schema(
  {
    boqItem: { type: mongoose.Schema.Types.ObjectId, ref: 'BOQItem', required: true },
    title: { type: String, trim: true, default: '' },
    unit: { type: String, trim: true, default: '' },
    claimedQuantity: { type: Number, default: 0, min: 0 },
    inspectedQuantity: { type: Number, default: 0, min: 0 },
    unitPrice: { type: Number, default: 0, min: 0 }
  },
  { _id: false }
);

/** One assigned inspector's decision, stamped with their profile signature at the moment they act */
const inspectorSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, trim: true, default: '' },
    designation: { type: String, trim: true, default: '' },
    status: { type: String, enum: ['Pending', 'Approved', 'Rejected'], default: 'Pending' },
    observations: { type: String, trim: true, default: '' },
    signature: { type: String, trim: true, default: '' },
    /** Site evidence uploaded with the decision — at least 3 images and 1 video */
    attachments: [
      {
        _id: false,
        kind: { type: String, enum: ['image', 'video'], required: true },
        url: { type: String, required: true },
        originalName: { type: String, trim: true, default: '' },
        mimeType: { type: String, trim: true, default: '' },
        size: { type: Number, default: 0 }
      }
    ],
    actedAt: { type: Date }
  },
  { _id: true }
);

/**
 * Inspection Report — site inspection of a Submitted Check Request.
 * Every assigned inspector must approve (any order); one rejection rejects the report.
 * Approved → the Check Request is verified with the inspected quantities / slab.
 */
const inspectionReportSchema = new mongoose.Schema(
  {
    project: { type: mongoose.Schema.Types.ObjectId, ref: 'ConstructionProject', required: true, index: true },
    masterProject: { type: mongoose.Schema.Types.ObjectId, ref: 'ConstructionProject', default: null },
    checkRequest: { type: mongoose.Schema.Types.ObjectId, ref: 'CheckRequest', required: true, index: true },

    reportNumber: { type: String, unique: true, sparse: true, trim: true, uppercase: true },
    inspectionDate: { type: Date, default: Date.now },
    location: { type: String, trim: true, default: '' },
    remarks: { type: String, trim: true, default: '' },

    /** Snapshot of the claim being inspected */
    claimType: { type: String, enum: ['BOQ', 'Slab'], default: 'BOQ' },
    items: { type: [inspectionItemSchema], default: [] },
    slab: {
      name: { type: String, trim: true, default: '' },
      percentage: { type: Number, default: 0 },
      amount: { type: Number, default: 0 }
    },
    inspectedTotal: { type: Number, default: 0, min: 0 },

    inspectors: {
      type: [inspectorSchema],
      validate: [(v) => Array.isArray(v) && v.length > 0, 'Assign at least one inspector']
    },

    status: {
      type: String,
      enum: ['Pending', 'Approved', 'Rejected', 'Cancelled'],
      default: 'Pending',
      index: true
    },
    completedAt: { type: Date },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  },
  { timestamps: true }
);

inspectionReportSchema.index({ 'inspectors.user': 1, status: 1 });

inspectionReportSchema.pre('save', async function generateNumber(next) {
  if (!this.isNew || this.reportNumber) return next();
  try {
    const year = new Date().getFullYear();
    const prefix = `IR-${year}-`;
    const latest = await this.constructor
      .findOne({ reportNumber: new RegExp(`^${prefix}`) })
      .sort({ reportNumber: -1 })
      .select('reportNumber')
      .lean();
    let sequence = 1;
    if (latest?.reportNumber) {
      const last = parseInt(latest.reportNumber.split('-').pop(), 10);
      if (!Number.isNaN(last)) sequence = last + 1;
    }
    this.reportNumber = `${prefix}${String(sequence).padStart(4, '0')}`;
    next();
  } catch (err) {
    next(err);
  }
});

module.exports = mongoose.model('InspectionReport', inspectionReportSchema);
