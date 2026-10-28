const mongoose = require('mongoose');

const ALLOWANCE_TAX_KEYS = [
  'conveyance',
  'food',
  'mobile',
  'vehicle',
  'fuel',
  'medical',
  'houseRent',
  'special',
  'other'
];

const allowancePolicySchema = new mongoose.Schema(
  {
    mode: {
      type: String,
      enum: ['taxable', 'fully_exempt', 'partial_exempt'],
      default: 'taxable'
    },
    exemptPercent: {
      type: Number,
      default: 0,
      min: 0,
      max: 100
    }
  },
  { _id: false }
);

const defaultAllowancePolicies = () => {
  const policies = {};
  ALLOWANCE_TAX_KEYS.forEach((key) => {
    policies[key] = { mode: 'taxable', exemptPercent: 0 };
  });
  return policies;
};

const payrollTaxSettingsSchema = new mongoose.Schema(
  {
    singletonKey: {
      type: String,
      default: 'default',
      unique: true
    },
    salaryMedicalExemptPercent: {
      type: Number,
      default: 10,
      min: 0,
      max: 100
    },
    allowancePolicies: {
      type: mongoose.Schema.Types.Mixed,
      default: defaultAllowancePolicies
    },
    applyScope: {
      type: String,
      enum: ['all', 'selected'],
      default: 'all'
    },
    selectedEmployeeIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Employee'
      }
    ],
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  },
  { timestamps: true }
);

payrollTaxSettingsSchema.statics.getOrCreate = async function () {
  let doc = await this.findOne({ singletonKey: 'default' });
  if (!doc) {
    doc = await this.create({
      singletonKey: 'default',
      allowancePolicies: defaultAllowancePolicies()
    });
  }
  return doc;
};

module.exports = mongoose.model('PayrollTaxSettings', payrollTaxSettingsSchema);
module.exports.ALLOWANCE_TAX_KEYS = ALLOWANCE_TAX_KEYS;
module.exports.defaultAllowancePolicies = defaultAllowancePolicies;
