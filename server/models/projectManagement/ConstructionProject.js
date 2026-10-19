const mongoose = require('mongoose');

const BUDGET_CATEGORIES = [
  'Civil Works', 'Finishes', 'Electrical', 'Plumbing', 'HVAC System',
  'Sewerage', 'Water Supply & Gas',
  'Labor', 'Consultancy', 'Materials', 'Contingency', 'Miscellaneous'
];

const milestoneSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true },
  description: { type: String, trim: true },
  plannedDate: { type: Date },
  actualDate: { type: Date },
  status: {
    type: String,
    enum: ['Pending', 'In Progress', 'Completed', 'Delayed'],
    default: 'Pending'
  },
  completionPercentage: { type: Number, default: 0, min: 0, max: 100 },
  billingTrigger: { type: Boolean, default: false },
  billingPercentage: { type: Number, default: 0, min: 0, max: 100 },
  notes: { type: String, trim: true }
}, { _id: true });

const budgetCategorySchema = new mongoose.Schema({
  category: { type: String, enum: BUDGET_CATEGORIES, required: true },
  estimatedAmount: { type: Number, default: 0, min: 0 },
  approvedAmount: { type: Number, default: 0, min: 0 }
}, { _id: true });

const documentSchema = new mongoose.Schema({
  filename: { type: String, trim: true },
  originalName: { type: String, trim: true },
  url: { type: String, trim: true },
  category: { type: String, trim: true, default: 'General' },
  uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  uploadedAt: { type: Date, default: Date.now }
}, { _id: true });

const constructionProjectSchema = new mongoose.Schema({
  projectNumber: {
    type: String,
    unique: true,
    sparse: true,
    trim: true
  },
  name: { type: String, required: true, trim: true },
  description: { type: String, trim: true },
  projectType: {
    type: String,
    enum: [
      'INFRASTRUCTURE DEVELOPMENT',
      'COMMERCIAL',
      'VILLAS',
      // Legacy values kept so existing projects still load/save until reclassified
      'Villa',
      'Apartment',
      'Commercial Building',
      'Infrastructure',
      'Renovation',
      'Other'
    ],
    default: 'INFRASTRUCTURE DEVELOPMENT'
  },
  status: {
    type: String,
    enum: ['Draft', 'Planning', 'Active', 'On Hold', 'Completed', 'Cancelled'],
    default: 'Draft'
  },

  // Project Hierarchy
  isMasterProject: {
    type: Boolean,
    default: false,
    index: true
  },
  parentProject: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ConstructionProject',
    default: null,
    index: true
  },

  // Location — optionally linked to existing Taj property
  linkedProperty: { type: mongoose.Schema.Types.ObjectId, ref: 'TajProperty', default: null },
  society: { type: String, trim: true },
  sector: { type: String, trim: true },
  plotNumber: { type: String, trim: true },
  address: { type: String, trim: true },

  // Client
  clientName: { type: String, trim: true },
  clientContact: { type: String, trim: true },

  // Team
  projectManager: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

  // Timeline
  startDate: { type: Date },
  expectedEndDate: { type: Date },
  actualEndDate: { type: Date },

  // Budget breakdown by category (Sub projects — after Main allocates a lump sum)
  budgetCategories: { type: [budgetCategorySchema], default: () => BUDGET_CATEGORIES.map(c => ({ category: c, estimatedAmount: 0, approvedAmount: 0 })) },

  // Main project: portfolio lump-sum envelope (not category-wise)
  lumpSumBudget: { type: Number, default: 0, min: 0 },

  // Sub project: amount allocated from Main lump-sum pool
  allocatedBudget: { type: Number, default: 0, min: 0 },

  // Aggregated totals (auto-computed on save)
  totalEstimatedCost: { type: Number, default: 0, min: 0 },
  totalApprovedBudget: { type: Number, default: 0, min: 0 },

  // Budget approval workflow
  budgetStatus: {
    type: String,
    enum: ['Draft', 'Submitted', 'Approved'],
    default: 'Draft'
  },
  budgetSubmittedAt: { type: Date },
  budgetApprovedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  budgetApprovedAt: { type: Date },
  budgetNotes: { type: String, trim: true },

  // Contract value (the amount the client pays — used for milestone billing)
  contractValue: { type: Number, default: 0, min: 0 },

  // Financial actuals (updated as expenses/POs are recorded)
  totalCommitted: { type: Number, default: 0, min: 0 },
  totalActualSpent: { type: Number, default: 0, min: 0 },
  totalInvoiced: { type: Number, default: 0, min: 0 },

  // Whole BOQ discount (applied after item-level discounts)
  boqDiscountAmount: { type: Number, default: 0, min: 0 },

  // Milestones
  milestones: { type: [milestoneSchema], default: [] },

  // Overall progress (0–100)
  overallProgress: { type: Number, default: 0, min: 0, max: 100 },

  // Documents
  documents: { type: [documentSchema], default: [] },

  notes: { type: String, trim: true },
  tags: [{ type: String, trim: true }],

  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

// Auto-generate project number and recompute totals before save
constructionProjectSchema.pre('save', async function (next) {
  if (this.isNew && !this.projectNumber) {
    const year = new Date().getFullYear();
    const count = await this.constructor.countDocuments();
    this.projectNumber = `CP-${year}-${String(count + 1).padStart(4, '0')}`;
  }

  // Recompute totals
  // Main / root: lump-sum envelope drives budget (not child rollup, not categories)
  if (!this.parentProject) {
    const lump = Number(this.lumpSumBudget) || 0;
    this.totalEstimatedCost = lump;
    this.totalApprovedBudget = this.budgetStatus === 'Approved' ? lump : 0;
  } else {
    // Sub: categories if detailed; otherwise allocated ceiling from Main
    const catEst = (this.budgetCategories || []).reduce((s, c) => s + (c.estimatedAmount || 0), 0);
    const catApp = (this.budgetCategories || []).reduce((s, c) => s + (c.approvedAmount || 0), 0);
    const allocated = Number(this.allocatedBudget) || 0;
    this.totalEstimatedCost = catEst > 0 ? catEst : allocated;
    this.totalApprovedBudget = this.budgetStatus === 'Approved'
      ? (catApp > 0 ? catApp : allocated)
      : 0;
  }

  next();
});

// Recompute totals from budgetCategories / lumpSum before findOneAndUpdate
constructionProjectSchema.pre('findOneAndUpdate', async function (next) {
  const update = this.getUpdate();
  if (!update) return next();

  const doc = await this.model.findOne(this.getQuery()).select('isMasterProject parentProject budgetStatus lumpSumBudget allocatedBudget budgetCategories');
  if (!doc) return next();

  const target = update.$set || update;
  const isRoot = !doc.parentProject;

  if (isRoot) {
    // Keep Main totals tied to lumpSumBudget; allow explicit lumpSumBudget updates
    const lump = target.lumpSumBudget !== undefined
      ? Number(target.lumpSumBudget) || 0
      : Number(doc.lumpSumBudget) || 0;
    const status = target.budgetStatus || doc.budgetStatus || 'Draft';
    target.totalEstimatedCost = lump;
    target.totalApprovedBudget = status === 'Approved' ? lump : 0;
    return next();
  }

  let cats = null;
  if (target.budgetCategories && Array.isArray(target.budgetCategories)) {
    cats = target.budgetCategories;
  }

  if (cats) {
    const catEst = cats.reduce((s, c) => s + (c.estimatedAmount || 0), 0);
    const catApp = cats.reduce((s, c) => s + (c.approvedAmount || 0), 0);
    const allocated = target.allocatedBudget !== undefined
      ? Number(target.allocatedBudget) || 0
      : Number(doc.allocatedBudget) || 0;
    const status = target.budgetStatus || doc.budgetStatus || 'Draft';
    target.totalEstimatedCost = catEst > 0 ? catEst : allocated;
    target.totalApprovedBudget = status === 'Approved' ? (catApp > 0 ? catApp : allocated) : 0;
  } else if (target.allocatedBudget !== undefined) {
    const allocated = Number(target.allocatedBudget) || 0;
    const existingCats = doc.budgetCategories || [];
    const catEst = existingCats.reduce((s, c) => s + (c.estimatedAmount || 0), 0);
    const status = target.budgetStatus || doc.budgetStatus || 'Draft';
    target.totalEstimatedCost = catEst > 0 ? catEst : allocated;
    if (status === 'Approved' && catEst === 0) {
      target.totalApprovedBudget = allocated;
    }
  }

  next();
});

constructionProjectSchema.index({ projectNumber: 1 });
constructionProjectSchema.index({ status: 1 });
constructionProjectSchema.index({ projectType: 1 });
constructionProjectSchema.index({ createdAt: -1 });
constructionProjectSchema.index({ projectManager: 1 });

const syncParentHelper = async (parentProjectId) => {
  if (!parentProjectId) return;
  const model = mongoose.model('ConstructionProject');
  const parent = await model.findById(parentProjectId).select('parentProject lumpSumBudget budgetStatus');
  if (!parent) return;

  const children = await model.find({
    parentProject: parentProjectId,
    status: { $ne: 'Cancelled' }
  }).select('overallProgress');

  const avg = children.length
    ? Math.round(children.reduce((s, c) => s + (c.overallProgress || 0), 0) / children.length)
    : 0;

  // Root / Main keeps its own lump-sum budget — only roll up progress
  if (!parent.parentProject) {
    await model.findByIdAndUpdate(parentProjectId, { overallProgress: avg });
    return;
  }

  // Intermediate parents (legacy): progress only (budget lives on leaves + root lump sum)
  await model.findByIdAndUpdate(parentProjectId, { overallProgress: avg });
  if (parent.parentProject) {
    await syncParentHelper(parent.parentProject);
  }
};

// Post-save hook (for .create() and .save())
constructionProjectSchema.post('save', async function (doc) {
  if (doc.parentProject) {
    await syncParentHelper(doc.parentProject);
  }
});

// Post-findOneAndUpdate hook (for findByIdAndUpdate, findOneAndUpdate)
constructionProjectSchema.post('findOneAndUpdate', async function (doc) {
  if (doc && doc.parentProject) {
    await syncParentHelper(doc.parentProject);
  }
});

// Post-updateOne hook (for updateOne)
constructionProjectSchema.post('updateOne', async function () {
  const query = this.getQuery();
  const doc = await this.model.findOne(query);
  if (doc && doc.parentProject) {
    await syncParentHelper(doc.parentProject);
  }
});

module.exports = mongoose.model('ConstructionProject', constructionProjectSchema);
module.exports.BUDGET_CATEGORIES = BUDGET_CATEGORIES;
