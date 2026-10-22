const mongoose = require('mongoose');

/**
 * One-month salary percentage cut for selected employees.
 * Does not change employee master salary — only applies when generating / updating that month's payroll.
 * EOBI remains full when the cut is applied.
 */
const payrollMonthSalaryCutSchema = new mongoose.Schema(
  {
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Employee',
      required: true,
      index: true
    },
    month: {
      type: Number,
      required: true,
      min: 1,
      max: 12
    },
    year: {
      type: Number,
      required: true,
      min: 2020
    },
    percentage: {
      type: Number,
      required: true,
      min: [0.01, 'Percentage must be greater than 0'],
      max: [99.99, 'Percentage must be less than 100']
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  },
  { timestamps: true }
);

payrollMonthSalaryCutSchema.index({ employee: 1, month: 1, year: 1 }, { unique: true });
payrollMonthSalaryCutSchema.index({ month: 1, year: 1 });

module.exports = mongoose.model('PayrollMonthSalaryCut', payrollMonthSalaryCutSchema);
