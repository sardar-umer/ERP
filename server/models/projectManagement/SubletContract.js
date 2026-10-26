const mongoose = require('mongoose');

const subletItemSchema = new mongoose.Schema(
  {
    boqItem: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'BOQItem',
      required: true
    },
    title: { type: String, trim: true, default: '' },
    description: { type: String, trim: true, default: '' },
    unit: { type: String, trim: true, default: '' },
    quantity: { type: Number, default: 0, min: 0 },
    unitPrice: { type: Number, default: 0, min: 0 },
    amount: { type: Number, default: 0, min: 0 },
    notes: { type: String, trim: true, default: '' }
  },
  { _id: true }
);

/** Slab-wise contracts: payment stage = % of contract value, covering master WBS activities. */
const subletSlabSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    percentage: { type: Number, required: true, min: 0, max: 100 },
    amount: { type: Number, default: 0, min: 0 },
    activities: [
      {
        _id: false,
        activity: { type: mongoose.Schema.Types.ObjectId, ref: 'WbsActivity' },
        name: { type: String, trim: true, default: '' },
        group: { type: String, trim: true, default: '' }
      }
    ],
    notes: { type: String, trim: true, default: '' }
  },
  { _id: true }
);

const SUBLET_CONTRACT_TYPES = ['BOQ', 'Slab'];

const subletContractSchema = new mongoose.Schema(
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

    contractNumber: {
      type: String,
      unique: true,
      sparse: true,
      trim: true,
      uppercase: true
    },

    title: {
      type: String,
      required: [true, 'Sublet contract title is required'],
      trim: true,
      maxlength: 250
    },

    contractor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Supplier',
      required: [true, 'Subcontractor is required'],
      index: true
    },

    /** Snapshot from project hierarchy at create time */
    mainProjectName: { type: String, trim: true, default: '' },
    subProjectName: { type: String, trim: true, default: '' },
    sector: { type: String, trim: true, default: '' },
    society: { type: String, trim: true, default: '' },

    /** BOQ = quantity × rate on BOQ lines; Slab = lump sum paid in % stages */
    contractType: {
      type: String,
      enum: SUBLET_CONTRACT_TYPES,
      default: 'BOQ',
      index: true
    },

    items: {
      type: [subletItemSchema],
      default: []
    },

    /** Slab-wise only */
    slabSchedule: { type: mongoose.Schema.Types.ObjectId, ref: 'SlabSchedule', default: null },
    slabs: {
      type: [subletSlabSchema],
      default: []
    },

    status: {
      type: String,
      enum: ['Draft', 'Active', 'Completed', 'Cancelled'],
      default: 'Draft',
      index: true
    },

    totalAmount: { type: Number, default: 0, min: 0 },

    startDate: { type: Date },
    endDate: { type: Date },

    notes: { type: String, trim: true, default: '' },

    activatedAt: { type: Date },
    activatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  },
  { timestamps: true }
);

subletContractSchema.index({ project: 1, status: 1 });
subletContractSchema.index({ project: 1, contractor: 1 });

subletContractSchema.pre('save', async function generateNumber(next) {
  if (!this.isNew || this.contractNumber) return next();
  try {
    const year = new Date().getFullYear();
    const prefix = `SLC-${year}-`;
    const latest = await this.constructor
      .findOne({ contractNumber: new RegExp(`^${prefix}`) })
      .sort({ contractNumber: -1 })
      .select('contractNumber')
      .lean();

    let sequence = 1;
    if (latest?.contractNumber) {
      const last = parseInt(latest.contractNumber.split('-').pop(), 10);
      if (!Number.isNaN(last)) sequence = last + 1;
    }
    this.contractNumber = `${prefix}${String(sequence).padStart(4, '0')}`;
    next();
  } catch (err) {
    next(err);
  }
});

module.exports = mongoose.model('SubletContract', subletContractSchema);
module.exports.SUBLET_CONTRACT_TYPES = SUBLET_CONTRACT_TYPES;
