const mongoose = require('mongoose');

const checkRequestItemSchema = new mongoose.Schema(
  {
    boqItem: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'BOQItem',
      required: true
    },
    title: { type: String, trim: true, default: '' },
    description: { type: String, trim: true, default: '' },
    unit: { type: String, trim: true, default: '' },
    claimedQuantity: { type: Number, default: 0, min: 0 },
    verifiedQuantity: { type: Number, default: 0, min: 0 },
    billedQuantity: { type: Number, default: 0, min: 0 },
    /** Verified quantity already billed to the client (Client Invoice from verified work) */
    clientBilledQuantity: { type: Number, default: 0, min: 0 },
    unitPrice: { type: Number, default: 0, min: 0 },
    claimedAmount: { type: Number, default: 0, min: 0 },
    verifiedAmount: { type: Number, default: 0, min: 0 },
    notes: { type: String, trim: true, default: '' }
  },
  { _id: true }
);

const checkRequestSchema = new mongoose.Schema(
  {
    project: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ConstructionProject',
      required: true,
      index: true
    },
    masterProject: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ConstructionProject',
      default: null,
      index: true
    },

    checkRequestNumber: {
      type: String,
      unique: true,
      sparse: true,
      trim: true,
      uppercase: true
    },

    title: {
      type: String,
      required: [true, 'Check request title is required'],
      trim: true,
      maxlength: 250
    },

    contractor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Supplier',
      default: null,
      index: true
    },

    /** Master WBS activity being inspected / claimed (from the Sub Project's Project Type) */
    activity: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'WbsActivity',
      default: null,
      index: true
    },

    /** Legacy per-project WBS task link (check requests created before WBS activities) */
    task: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ProjectTask',
      default: null
    },

    /** BOQ = claim executed BOQ quantities; Slab = claim one payment stage of a slab-wise sublet contract */
    claimType: {
      type: String,
      enum: ['BOQ', 'Slab'],
      default: 'BOQ'
    },
    subletContract: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SubletContract',
      default: null,
      index: true
    },
    /** Snapshot of the claimed slab (Slab claims only) */
    slab: {
      slabId: { type: mongoose.Schema.Types.ObjectId, default: null },
      name: { type: String, trim: true, default: '' },
      percentage: { type: Number, default: 0 },
      amount: { type: Number, default: 0 },
      activities: [
        {
          _id: false,
          activity: { type: mongoose.Schema.Types.ObjectId, ref: 'WbsActivity' },
          name: { type: String, trim: true, default: '' }
        }
      ]
    },

    items: {
      type: [checkRequestItemSchema],
      default: []
    },

    status: {
      type: String,
      enum: ['Draft', 'Submitted', 'Verified', 'Rejected', 'Cancelled', 'Billed'],
      default: 'Draft',
      index: true
    },

    claimedTotal: { type: Number, default: 0, min: 0 },
    verifiedTotal: { type: Number, default: 0, min: 0 },

    submittedAt: { type: Date },
    submittedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

    verifiedAt: { type: Date },
    verifiedBy: { type: String, trim: true, default: '' },
    verifiedByUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    verificationNotes: { type: String, trim: true, default: '' },
    verificationPhotoUrl: { type: String, trim: true, default: '' },

    rejectionReason: { type: String, trim: true, default: '' },
    rejectedAt: { type: Date },
    rejectedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

    linkedInvoice: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ProjectInvoice',
      default: null
    },

    notes: { type: String, trim: true, default: '' },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  },
  { timestamps: true }
);

checkRequestSchema.index({ project: 1, status: 1 });
checkRequestSchema.index({ project: 1, createdAt: -1 });

checkRequestSchema.pre('save', async function generateNumber(next) {
  if (!this.isNew || this.checkRequestNumber) return next();
  try {
    const year = new Date().getFullYear();
    const prefix = `CR-${year}-`;
    const latest = await this.constructor
      .findOne({ checkRequestNumber: new RegExp(`^${prefix}`) })
      .sort({ checkRequestNumber: -1 })
      .select('checkRequestNumber')
      .lean();

    let sequence = 1;
    if (latest?.checkRequestNumber) {
      const last = parseInt(latest.checkRequestNumber.split('-').pop(), 10);
      if (!Number.isNaN(last)) sequence = last + 1;
    }
    this.checkRequestNumber = `${prefix}${String(sequence).padStart(4, '0')}`;
    next();
  } catch (err) {
    next(err);
  }
});

module.exports = mongoose.model('CheckRequest', checkRequestSchema);
