const mongoose = require('mongoose');
const { WBS_PROJECT_TYPES } = require('./WbsActivity');

/**
 * Reusable slab (percentage-wise) payment schedule for a Project Type.
 * Each slab is a payment stage covering a set of master WBS activities; percentages total 100.
 */
const slabSchema = new mongoose.Schema(
  {
    name: { type: String, required: [true, 'Slab name is required'], trim: true, maxlength: 200 },
    percentage: { type: Number, required: true, min: 0, max: 100 },
    activities: [{ type: mongoose.Schema.Types.ObjectId, ref: 'WbsActivity' }],
    description: { type: String, trim: true, default: '' }
  },
  { _id: true }
);

const slabScheduleSchema = new mongoose.Schema(
  {
    projectType: {
      type: String,
      enum: WBS_PROJECT_TYPES,
      required: [true, 'Project type is required'],
      index: true
    },
    name: {
      type: String,
      required: [true, 'Schedule name is required'],
      trim: true,
      maxlength: 200
    },
    description: { type: String, trim: true, default: '' },
    slabs: {
      type: [slabSchema],
      validate: {
        validator: (slabs) => Array.isArray(slabs) && slabs.length > 0,
        message: 'Add at least one slab'
      }
    },
    isActive: { type: Boolean, default: true, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  },
  { timestamps: true }
);

slabScheduleSchema.index({ projectType: 1, name: 1 });

module.exports = mongoose.model('SlabSchedule', slabScheduleSchema);
