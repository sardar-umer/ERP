const mongoose = require('mongoose');

/** Project types that own a WBS activity master (matches ConstructionProject.projectType). */
const WBS_PROJECT_TYPES = ['INFRASTRUCTURE DEVELOPMENT', 'COMMERCIAL', 'VILLAS'];

/** Map legacy ConstructionProject.projectType values onto the three master types. */
const LEGACY_PROJECT_TYPE_MAP = {
  Villa: 'VILLAS',
  Apartment: 'COMMERCIAL',
  'Commercial Building': 'COMMERCIAL',
  Infrastructure: 'INFRASTRUCTURE DEVELOPMENT'
};

const normalizeProjectType = (value) => {
  if (!value) return null;
  if (WBS_PROJECT_TYPES.includes(value)) return value;
  return LEGACY_PROJECT_TYPE_MAP[value] || null;
};

/**
 * Master WBS activity — defined once per Project Type and reused by every Sub Project of that type.
 * Hierarchy: Project Type → Group → Activity.
 */
const wbsActivitySchema = new mongoose.Schema(
  {
    projectType: {
      type: String,
      enum: WBS_PROJECT_TYPES,
      required: [true, 'Project type is required'],
      index: true
    },
    group: {
      type: String,
      required: [true, 'Activity group is required'],
      trim: true,
      maxlength: 120
    },
    name: {
      type: String,
      required: [true, 'Activity name is required'],
      trim: true,
      maxlength: 200
    },
    code: { type: String, trim: true, uppercase: true, default: '' },
    unit: { type: String, trim: true, default: '' },
    description: { type: String, trim: true, default: '' },
    orderIndex: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  },
  { timestamps: true }
);

wbsActivitySchema.index({ projectType: 1, group: 1, orderIndex: 1 });
wbsActivitySchema.index(
  { projectType: 1, group: 1, name: 1 },
  { unique: true, collation: { locale: 'en', strength: 2 } }
);

const WbsActivity = mongoose.model('WbsActivity', wbsActivitySchema);

module.exports = WbsActivity;
module.exports.WBS_PROJECT_TYPES = WBS_PROJECT_TYPES;
module.exports.normalizeProjectType = normalizeProjectType;
