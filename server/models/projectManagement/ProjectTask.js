const mongoose = require('mongoose');

const projectTaskSchema = new mongoose.Schema({
  project: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ConstructionProject',
    required: true,
    index: true
  },

  // Hierarchy: level 0 = Phase, level 1 = Task, level 2 = Subtask
  parentTask: { type: mongoose.Schema.Types.ObjectId, ref: 'ProjectTask', default: null },
  level: { type: Number, default: 0, min: 0, max: 2 },
  orderIndex: { type: Number, default: 0 },

  title: { type: String, required: true, trim: true },
  // Master WBS link: level 0 rows mirror an activity group, level 1 rows mirror a WbsActivity.
  // Rows without these are legacy free-form tasks (hidden from the WBS tab).
  activity: { type: mongoose.Schema.Types.ObjectId, ref: 'WbsActivity', default: null, index: true },
  activityGroup: { type: String, trim: true, default: '' },
  description: { type: String, trim: true },

  // Timeline
  plannedStartDate: { type: Date },
  plannedEndDate: { type: Date },
  actualStartDate: { type: Date },
  actualEndDate: { type: Date },

  // Status & Progress
  status: {
    type: String,
    enum: ['Not Started', 'In Progress', 'Completed', 'On Hold', 'Cancelled'],
    default: 'Not Started'
  },
  progressPercent: { type: Number, default: 0, min: 0, max: 100 },

  // Assignment
  assignedTo: { type: String, trim: true },
  estimatedLaborCost: { type: Number, default: 0, min: 0 },
  actualLaborCost: { type: Number, default: 0, min: 0 },

  // Task dependencies (blocked until these are complete)
  dependencies: [{ type: mongoose.Schema.Types.ObjectId, ref: 'ProjectTask' }],

  notes: { type: String, trim: true },

  // Physical Verification Sign-off (Option B)
  isPhysicallyVerified: { type: Boolean, default: false },
  verifiedAt: { type: Date },
  verifiedBy: { type: String, trim: true },
  verificationNotes: { type: String, trim: true },
  verificationPhotoUrl: { type: String, trim: true },

  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

// Auto-set status based on progress
projectTaskSchema.pre('save', function (next) {
  if (this.progressPercent === 100 && this.status !== 'Cancelled') {
    this.status = 'Completed';
    if (!this.actualEndDate) this.actualEndDate = new Date();
  } else if (this.progressPercent > 0 && this.progressPercent < 100 && this.status === 'Not Started') {
    this.status = 'In Progress';
    if (!this.actualStartDate) this.actualStartDate = new Date();
  }
  next();
});

projectTaskSchema.index({ project: 1, parentTask: 1, orderIndex: 1 });
projectTaskSchema.index({ project: 1, level: 1 });
// One WBS row per master activity / activity group per project (guards concurrent master sync)
projectTaskSchema.index(
  { project: 1, activity: 1 },
  { unique: true, partialFilterExpression: { activity: { $type: 'objectId' } } }
);
projectTaskSchema.index(
  { project: 1, activityGroup: 1 },
  { unique: true, partialFilterExpression: { level: 0, activityGroup: { $gt: '' } } }
);

module.exports = mongoose.model('ProjectTask', projectTaskSchema);
