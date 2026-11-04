const mongoose = require('mongoose');

/**
 * One saved edit of an employee record: which tracked fields changed (old → new), who changed it and when.
 * Written automatically by the Employee model hooks (server/utils/employeeChangeTracking.js).
 */
const employeeChangeLogSchema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
    changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    changedAt: { type: Date, default: Date.now, index: true },
    /** live = recorded when the edit was saved; audit = rebuilt from the audit trail of earlier edits */
    source: { type: String, enum: ['live', 'audit'], default: 'live' },
    changes: [
      {
        _id: false,
        field: { type: String, required: true },
        label: { type: String, required: true },
        from: { type: String, default: '' },
        to: { type: String, default: '' }
      }
    ]
  },
  { versionKey: false }
);

employeeChangeLogSchema.index({ employee: 1, changedAt: -1 });

module.exports = mongoose.model('EmployeeChangeLog', employeeChangeLogSchema);
