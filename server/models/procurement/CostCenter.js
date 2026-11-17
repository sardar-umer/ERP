const mongoose = require('mongoose');

const costCenterSchema = new mongoose.Schema({
  code: {
    type: String,
    required: [true, 'Cost center code is required'],
    unique: true,
    trim: true,
    uppercase: true,
    maxlength: [20, 'Code cannot exceed 20 characters']
  },
  name: {
    type: String,
    required: [true, 'Cost center name is required'],
    trim: true,
    maxlength: [100, 'Name cannot exceed 100 characters']
  },
  description: {
    type: String,
    trim: true,
    maxlength: [500, 'Description cannot exceed 500 characters']
  },
  parent: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'CostCenter',
    default: null
  },
  /**
   * Companies that may use this cost center (same company list as documents' companyId); empty = every company.
   * Read through CostCenter.companyIdsOf(), which also understands the older single `company` field.
   */
  companies: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'PlacementCompany'
  }],
  /** Older single-company field: kept equal to the first of `companies` so older screens and reports still read it */
  company: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'PlacementCompany'
  },
  project: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Project'
  },
  level: {
    type: Number,
    default: 0
  },
  path: {
    type: String,
    trim: true
  },
  department: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Department'
  },
  departmentName: {
    type: String,
    trim: true
  },
  /**
   * The one cost center documents raised by this department pre-fill with (utils/costCenterPolicy).
   * At most one active default per department; sub-cost centers may share the department without being the default.
   */
  isDepartmentDefault: {
    type: Boolean,
    default: false
  },
  location: {
    type: String,
    trim: true
  },
  manager: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  managerName: {
    type: String,
    trim: true
  },
  /** Matching Finance cost center per company, so SIN / return journals carry this cost center (utils/costCenterLink) */
  financeLinks: [{
    _id: false,
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'PlacementCompany' },
    financeCostCenter: { type: mongoose.Schema.Types.ObjectId, ref: 'FinanceCostCenter' }
  }],
  budget: {
    type: Number,
    default: 0,
    min: 0
  },
  budgetPeriod: {
    type: String,
    enum: ['Monthly', 'Quarterly', 'Annual'],
    default: 'Annual'
  },
  isActive: {
    type: Boolean,
    default: true
  },
  notes: {
    type: String,
    trim: true
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true
});

costCenterSchema.index({ code: 1 });
costCenterSchema.index({ department: 1 });
costCenterSchema.index({ department: 1, isDepartmentDefault: 1, isActive: 1 });
costCenterSchema.index({ isActive: 1 });

/** Company ids a cost center belongs to ([] = shared by every company); works on lean or populated docs */
costCenterSchema.statics.companyIdsOf = function companyIdsOf(cc) {
  const idOf = (v) => String(v?._id || v || '');
  const list = (cc?.companies || []).map(idOf).filter(Boolean);
  if (list.length) return [...new Set(list)];
  const single = idOf(cc?.company);
  return single ? [single] : [];
};

// Old records: lift the single company into the list; keep the single field in step with the list
costCenterSchema.pre('validate', function syncCompanies(next) {
  if ((!this.companies || this.companies.length === 0) && this.company && !this.isModified('companies')) {
    this.companies = [this.company];
  }
  const unique = [...new Set((this.companies || []).map((c) => String(c?._id || c)).filter(Boolean))];
  if (unique.length !== (this.companies || []).length) this.companies = unique;
  this.company = unique[0] || null;
  next();
});

costCenterSchema.index({ companies: 1 });

module.exports = mongoose.model('CostCenter', costCenterSchema);
