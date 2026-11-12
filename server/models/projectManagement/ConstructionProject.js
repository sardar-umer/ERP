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

/**
 * One unit built inside a Sub Project — a villa (or a floor / shop). Sublet contracts cover
 * one or more units, and claims are made per unit.
 */
const unitSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  plotNumber: { type: String, trim: true, default: '' },
  street: { type: String, trim: true, default: '' },
  side: { type: String, enum: ['', 'Left', 'Right'], default: '' },
  notes: { type: String, trim: true, default: '' }
}, { _id: true });

/** One person in a Main Project budget's approval chain, signed with their profile signature when they act */
const budgetApproverSchema = new mongoose.Schema({
  role: { type: String, trim: true, default: '' }, // shown on the document, e.g. "Chief Operating Officer"
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  name: { type: String, trim: true, default: '' },
  designation: { type: String, trim: true, default: '' },
  status: { type: String, enum: ['Pending', 'Approved', 'Rejected'], default: 'Pending' },
  remarks: { type: String, trim: true, default: '' },
  signature: { type: String, trim: true, default: '' },
  actedAt: { type: Date },
  /** Amounts this approver cut or added before approving */
  changes: [{ _id: false, subProject: mongoose.Schema.Types.ObjectId, name: String, from: Number, to: Number }]
}, { _id: true });

/**
 * Budget request of a Main Project: what the money is for, its split per Sub Project and who approves it
 * (one after another). Once the last approver signs, each line becomes that Sub Project's budget.
 */
const budgetRequestSchema = new mongoose.Schema({
  purpose: { type: String, trim: true, default: '' },
  notes: { type: String, trim: true, default: '' },
  lines: [{
    _id: false,
    subProject: { type: mongoose.Schema.Types.ObjectId, ref: 'ConstructionProject', required: true },
    name: { type: String, trim: true, default: '' },
    scope: { type: String, trim: true, default: '' },
    /** Ongoing projects: spent before the project came into the ERP (not available for new contracts) */
    utilized: { type: Number, default: 0, min: 0 },
    /** Remaining budget — what the Sub Project can still put into contracts */
    amount: { type: Number, default: 0, min: 0 }
  }],
  approvers: { type: [budgetApproverSchema], default: [] },
  /** Amounts as the project team sent them, before any approver changed them */
  submittedLines: [{ _id: false, subProject: mongoose.Schema.Types.ObjectId, amount: Number, utilized: Number }],
  currentStep: { type: Number, default: -1 }, // index of the approver whose turn it is; -1 when not in approval
  revision: { type: Number, default: 0 },
  preparedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  preparedByName: { type: String, trim: true, default: '' },
  submittedAt: { type: Date },
  returned: {
    name: { type: String, trim: true, default: '' },
    role: { type: String, trim: true, default: '' },
    remarks: { type: String, trim: true, default: '' },
    at: { type: Date }
  },
  history: [{
    _id: false,
    action: { type: String, trim: true },
    name: { type: String, trim: true, default: '' },
    remarks: { type: String, trim: true, default: '' },
    at: { type: Date, default: Date.now }
  }]
}, { _id: false });

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
  /**
   * How the work is contracted: BOQ-wise (quantities × rates) or Slab-wise (stage payments).
   * Chosen on the Main Project and copied to every Sub Project (like projectType);
   * every sublet contract under it must be of this kind. null = legacy project, either kind allowed.
   */
  contractBasis: { type: String, enum: ['BOQ', 'Slab', null], default: null },
  /**
   * How subcontractors are paid: Cash, Barter (in property — plots / villas — instead of cash) or
   * Mixed (part cash, part property). Chosen on the Main Project and copied to its Sub Projects.
   * Independent of contractBasis, which is how the work is measured.
   */
  paymentMode: { type: String, enum: ['Cash', 'Barter', 'Mixed'], default: 'Cash' },
  /** Sub Project contract type: Barter, Labor Rate or Finishing ('' = not set / Main Project) */
  contractType: { type: String, enum: ['', 'Barter', 'Labor Rate', 'Finishing'], default: '' },

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
  /**
   * Store business unit (HR / store "Project", e.g. Boly.Pk) whose stock this project's goods go into.
   * Set on the Main Project; Sub Projects use their Main Project's. GRNs from project POs default to it.
   */
  storeProject: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', default: null },
  /** Finance company the project's costs post to (set on the Main Project; Sub Projects inherit) */
  companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'PlacementCompany', default: null },
  society: { type: String, trim: true },
  sector: { type: String, trim: true },
  plotNumber: { type: String, trim: true },
  // Sub Project location within the sector
  street: { type: String, trim: true, default: '' },
  side: { type: String, enum: ['', 'Left', 'Right'], default: '' },
  /**
   * Sub Project size, in the unit its type uses: plot size in Marla / Kanal for villas, covered
   * area for commercial, length or area for infrastructure.
   */
  sizeValue: { type: Number, default: null, min: 0 },
  sizeUnit: { type: String, trim: true, default: '' },
  address: { type: String, trim: true },
  /** Sub Project only: the villas / units being built in it */
  units: { type: [unitSchema], default: [] },

  // Client
  clientName: { type: String, trim: true },
  clientContact: { type: String, trim: true },

  // Team
  projectManager: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  /** Project Manager on site, picked from HR employees (most managers have no ERP login) */
  projectManagerEmployee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', default: null },

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
  /** Sub Project (ongoing): budget already utilized before the ERP — total budget = utilizedBudget + allocatedBudget */
  utilizedBudget: { type: Number, default: 0, min: 0 },

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
  /** Main Project only: the detailed budget request and its approval chain */
  budgetRequest: { type: budgetRequestSchema, default: undefined },
  /**
   * Main Project only: the budget currently in force — a copy of the request as it was finally approved.
   * A later revision is prepared and approved in budgetRequest while this one stays in force.
   */
  approvedBudget: {
    type: new mongoose.Schema({
      amount: { type: Number, default: 0 }, // remaining budget (what contracts can use)
      utilized: { type: Number, default: 0 }, // already utilized before the ERP
      revision: { type: Number, default: 0 },
      approvedAt: { type: Date },
      submittedAt: { type: Date },
      purpose: { type: String, default: '' },
      notes: { type: String, default: '' },
      preparedByName: { type: String, default: '' },
      lines: [{ _id: false, subProject: mongoose.Schema.Types.ObjectId, name: String, scope: String, utilized: Number, amount: Number, requested: Number }],
      approvers: [{
        _id: false, role: String, user: mongoose.Schema.Types.ObjectId, name: String, designation: String, status: String, remarks: String, signature: String, actedAt: Date,
        changes: [{ _id: false, subProject: mongoose.Schema.Types.ObjectId, name: String, from: Number, to: Number }]
      }]
    }, { _id: false }),
    default: undefined
  },
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
    // Next number after the highest one used this year (a document count repeats numbers once anything is deleted)
    const year = new Date().getFullYear();
    const prefix = `CP-${year}-`;
    const [latest] = await this.constructor.aggregate([
      { $match: { projectNumber: new RegExp(`^${prefix}\\d+$`) } },
      { $project: { seq: { $toInt: { $substrCP: ['$projectNumber', prefix.length, 10] } } } },
      { $sort: { seq: -1 } },
      { $limit: 1 }
    ]);
    this.projectNumber = `${prefix}${String((latest?.seq || 0) + 1).padStart(4, '0')}`;
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

// projectNumber is indexed by its `unique: true` field option; a second plain index here conflicts with it
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
