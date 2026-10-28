const mongoose = require('mongoose');

const indentSchema = new mongoose.Schema({
  // Indent Number (Auto-generated)
  indentNumber: {
    type: String,
    required: false, // Will be auto-generated in pre-save middleware
    unique: true,
    sparse: true,
    trim: true
  },

  // Basic Information
  title: {
    type: String,
    required: [true, 'Indent title is required'],
    trim: true,
    maxlength: [200, 'Title cannot exceed 200 characters']
  },
  description: {
    type: String,
    trim: true,
    maxlength: [1000, 'Description cannot exceed 1000 characters']
  },

  // Company / Legal Entity
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'PlacementCompany',
    index: true,
    default: null
  },

  // Department and Requester
  department: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Department',
    required: [true, 'Department is required']
  },
  requestedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Requester is required']
  },

  // Items
  items: [{
    itemName: {
      type: String,
      required: [true, 'Item name is required'],
      trim: true
    },
    /** Catalog link — filled from the catalog by code / exact name on save */
    itemCode: { type: String, trim: true, default: '' },
    itemMaster: { type: mongoose.Schema.Types.ObjectId, ref: 'ItemMaster', default: null },
    description: {
      type: String,
      required: [true, 'Item description is required'],
      trim: true
    },
    brand: {
      type: String,
      required: [true, 'Brand is required'],
      trim: true
    },
    quantity: {
      type: Number,
      required: [true, 'Quantity is required'],
      min: [1, 'Quantity must be at least 1']
    },
    unit: {
      type: String,
      required: [true, 'Unit is required'],
      trim: true,
      default: 'Piece'
    },
    purpose: {
      type: String,
      required: [true, 'Purpose is required'],
      trim: true
    },
    estimatedCost: {
      type: Number,
      required: [true, 'Estimated cost is required'],
      min: [0, 'Estimated cost cannot be negative'],
      default: 0
    },
    orderedQuantity: {
      type: Number,
      default: 0,
      min: [0, 'Ordered quantity cannot be negative']
    },
    priority: {
      type: String,
      enum: ['Low', 'Medium', 'High', 'Urgent'],
      default: 'Medium'
    },
    remarks: {
      type: String,
      trim: true
    }
  }],

  // Status
  status: {
    type: String,
    enum: ['Draft', 'Submitted', 'Under Review', 'Approved', 'Rejected', 'Rejected in Procurement', 'Partially Fulfilled', 'Fulfilled', 'Cancelled'],
    default: 'Draft'
  },
  // Store routing: when approved, indent goes to Store first. Store checks stock.
  // pending_store_check = in Store Dashboard; moved_to_procurement = moved to Procurement Requisitions by store
  storeRoutingStatus: {
    type: String,
    enum: [null, 'pending_store_check', 'moved_to_procurement'],
    default: null
  },
  movedToProcurementBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  movedToProcurementAt: {
    type: Date
  },
  movedToProcurementReason: {
    type: String,
    trim: true
  },
  procurementAssignment: {
    status: {
      type: String,
      enum: ['unassigned', 'assigned'],
      default: 'unassigned'
    },
    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    assignedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    assignedAt: {
      type: Date,
      default: null
    },
    note: {
      type: String,
      trim: true,
      default: ''
    },
    history: [{
      assignedTo: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
      },
      assignedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
      },
      assignedAt: {
        type: Date,
        default: Date.now
      },
      note: {
        type: String,
        trim: true,
        default: ''
      }
    }]
  },
  procurementRejection: {
    rejectedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    rejectedAt: {
      type: Date,
      default: null
    },
    observation: {
      type: String,
      trim: true,
      default: ''
    }
  },

  // Dates
  requestedDate: {
    type: Date,
    default: Date.now
  },
  requiredDate: {
    type: Date,
    required: [true, 'Required date is required']
  },
  approvedDate: {
    type: Date
  },
  fulfilledDate: {
    type: Date
  },

  // Approval (legacy: single approver on indent.approvedBy; new: parallel chain — all must approve)
  approvalChain: [{
    approver: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending'
    },
    actedAt: {
      type: Date
    },
    comment: {
      type: String,
      trim: true
    }
  }],
  // Draft only: chosen approvers before submit (max 3), persisted so user can save and return
  draftApproverIds: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  approvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  rejectionReason: {
    type: String,
    trim: true
  },
  lastRejectionReason: {
    type: String,
    trim: true,
    default: ''
  },
  rejectionHistory: [{
    rejectedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    rejectedAt: {
      type: Date,
      default: Date.now
    },
    reason: {
      type: String,
      trim: true,
      default: ''
    },
    fromStatus: {
      type: String,
      trim: true,
      default: ''
    }
  }],

  // Financial Information
  totalEstimatedCost: {
    type: Number,
    default: 0,
    min: [0, 'Total estimated cost cannot be negative']
  },

  // Reference and Amount Information
  referenceNo: {
    type: String,
    trim: true
  },
  erpRef: {
    type: String,
    trim: true,
    unique: true,
    sparse: true
  },
  amount: {
    type: Number,
    min: [0, 'Amount cannot be negative'],
    default: 0
  },

  // Justification
  justification: {
    type: String,
    required: [true, 'Justification is required'],
    trim: true
  },

  // Comparative Statement approval authorities (editable names/designations at bottom of comparative statement)
  comparativeStatementApprovals: {
    preparedBy: { type: String, trim: true, default: '' },
    preparedByUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    verifiedBy: { type: String, trim: true, default: '' },
    verifiedByUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    authorisedRep: { type: String, trim: true, default: '' },
    authorisedRepUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    financeRep: { type: String, trim: true, default: '' },
    financeRepUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    managerProcurement: { type: String, trim: true, default: '' },
    managerProcurementUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }
  },
  // Comparative Statement approver workflow (non-sequential, all selected approvers must approve)
  comparativeApproval: {
    status: {
      type: String,
      enum: ['not_configured', 'draft', 'submitted', 'approved', 'rejected'],
      default: 'not_configured'
    },
    approvers: [{
      approver: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
      },
      status: {
        type: String,
        enum: ['pending', 'approved', 'rejected'],
        default: 'pending'
      },
      actedAt: {
        type: Date,
        default: null
      },
      comment: {
        type: String,
        trim: true,
        default: ''
      }
    }],
    submittedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    submittedAt: {
      type: Date,
      default: null
    },
    lastResubmittedAt: {
      type: Date,
      default: null
    },
    rejectedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    rejectedAt: {
      type: Date,
      default: null
    },
    rejectionObservation: {
      type: String,
      trim: true,
      default: ''
    },
    rejectionObservations: [{
      observation: { type: String, trim: true, default: '' },
      rejectedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
      rejectedAt: { type: Date, default: null },
      resolutionNote: { type: String, trim: true, default: '' },
      resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
      resolvedAt: { type: Date, default: null }
    }]
  },

  // Lot-based Comparative Statement approvals
  comparativeApprovals: [{
    lotNumber: { type: String, required: true },
    status: { type: String, enum: ['not_configured', 'draft', 'submitted', 'pending', 'approved', 'rejected'], default: 'not_configured' },
    approvers: [{
      approver: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
      },
      status: {
        type: String,
        enum: ['pending', 'approved', 'rejected'],
        default: 'pending'
      },
      actedAt: {
        type: Date,
        default: null
      },
      comment: {
        type: String,
        trim: true,
        default: ''
      }
    }],
    submittedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    submittedAt: { type: Date, default: null },
    lastResubmittedAt: { type: Date, default: null },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    approvedAt: { type: Date },
    rejectedAt: { type: Date },
    rejectedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    rejectionReason: { type: String, trim: true, default: '' },
    rejectionObservation: { type: String, trim: true, default: '' },
    rejectionObservations: [{
      observation: { type: String, trim: true, default: '' },
      rejectedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
      rejectedAt: { type: Date, default: null },
      resolutionNote: { type: String, trim: true, default: '' },
      resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
      resolvedAt: { type: Date, default: null }
    }],
    note: { type: String, trim: true, default: '' }
  }],

  // Per-item vendor assignments from Comparative Statement (item index -> quotation id). When set, quotations are shortlisted; create split POs from Quotations page.
  splitPOAssignments: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },

  // Signatures
  signatures: {
    requester: {
      name: {
        type: String,
        trim: true
      },
      date: {
        type: Date
      }
    },
    headOfDepartment: {
      name: {
        type: String,
        trim: true
      },
      date: {
        type: Date
      }
    },
    gmPd: {
      name: {
        type: String,
        trim: true
      },
      date: {
        type: Date
      }
    },
    svpAvp: {
      name: {
        type: String,
        trim: true
      },
      date: {
        type: Date
      }
    }
  },

  // Additional Information
  priority: {
    type: String,
    required: [true, 'Priority is required'],
    enum: ['Low', 'Medium', 'High', 'Urgent'],
    default: 'Medium'
  },
  category: {
    type: String,
    required: [true, 'Category is required'],
    trim: true,
    maxlength: [200, 'Category cannot exceed 200 characters']
  },
  /** Required when category is "Others"; cleared when category is catalog */
  categoryOtherDescription: {
    type: String,
    trim: true,
    default: '',
    maxlength: [500, 'Category detail cannot exceed 500 characters']
  },

  // Attachments
  attachments: [{
    filename: {
      type: String,
      required: true
    },
    path: {
      type: String,
      required: true
    },
    uploadedAt: {
      type: Date,
      default: Date.now
    }
  }],

  // Notes and Comments
  notes: {
    type: String,
    trim: true
  },
  comments: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    comment: {
      type: String,
      required: true,
      trim: true
    },
    createdAt: {
      type: Date,
      default: Date.now
    }
  }],

  // Workflow timeline (similar to PO/Pre-Audit tracking)
  workflowHistory: [{
    fromStatus: {
      type: String,
      trim: true
    },
    toStatus: {
      type: String,
      trim: true
    },
    changedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    changedAt: {
      type: Date,
      default: Date.now
    },
    comments: {
      type: String,
      trim: true
    },
    module: {
      type: String,
      trim: true,
      default: 'Indent'
    }
  }],

  // Metadata
  isActive: {
    type: Boolean,
    default: true
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

indentSchema.statics.generateERPRef = async function () {
  const indents = await this.find({ erpRef: { $exists: true, $ne: '' } })
    .select('erpRef')
    .lean();

  let maxNum = 0;
  for (const ind of indents) {
    if (!ind.erpRef) continue;
    const match = ind.erpRef.match(/#?(\d+)/);
    if (match && match[1]) {
      const num = parseInt(match[1], 10);
      if (!isNaN(num) && num > maxNum) {
        maxNum = num;
      }
    }
  }

  return `PR #${maxNum + 1}`;
};

// Link lines to the Item Catalog (code + id) so PO / GRN / SIN carry the same item
indentSchema.pre('save', async function (next) {
  try {
    if (this.isNew || this.isModified('items')) {
      const { annotateLines } = require('../../utils/itemCatalog');
      await annotateLines(this.items, { nameField: 'itemName', codeField: 'itemCode' });
    }
  } catch (err) {
    console.warn('[Indent] item catalog link skipped:', err.message);
  }
  next();
});

// Pre-save middleware to calculate total estimated cost and generate ERP Ref and Indent Number
indentSchema.pre('save', async function (next) {
  // Calculate total estimated cost
  if (this.items && this.items.length > 0) {
    this.totalEstimatedCost = this.items.reduce((total, item) => {
      return total + ((item.estimatedCost || 0) * (item.quantity || 0));
    }, 0);
  } else {
    this.totalEstimatedCost = 0;
  }

  // Auto-generate Indent Number if not provided and this is a new document
  if ((!this.indentNumber || this.indentNumber.trim() === '') && this.isNew) {
    try {
      this.indentNumber = await this.constructor.generateIndentNumber();
    } catch (error) {
      return next(error);
    }
  }

  // Auto-generate ERP Ref if not provided and this is a new document
  if ((!this.erpRef || this.erpRef.trim() === '') && this.isNew) {
    try {
      this.erpRef = await this.constructor.generateERPRef();
    } catch (error) {
      return next(error);
    }
  }

  // Ensure indentNumber and erpRef are set (only for new documents; updates may have legacy empty values)
  if (this.isNew) {
    if (!this.indentNumber || this.indentNumber.trim() === '') {
      return next(new Error('Indent Number is required'));
    }
    if (!this.erpRef || this.erpRef.trim() === '') {
      return next(new Error('ERP Ref is required'));
    }
  }

  next();
});

// Generate indent number (last indent + 1 to ensure sequential ordering)
indentSchema.statics.generateIndentNumber = async function () {
  const indents = await this.find({ indentNumber: { $exists: true, $ne: '' } })
    .select('indentNumber')
    .lean();

  let maxNum = 0;
  for (const ind of indents) {
    if (!ind.indentNumber) continue;
    // Extract numbers from formats like "IND-2026-0012", "IND-15", "15", "PR #15"
    // Match the last group of numbers in the string
    const matches = ind.indentNumber.match(/(\d+)(?:\D*)$/);
    if (matches && matches[1]) {
      const num = parseInt(matches[1], 10);
      // Ignore timestamp-like numbers (> 100000000) that were created previously
      if (!isNaN(num) && num < 100000000 && num > maxNum) {
        maxNum = num;
      }
    } else {
      // Fallback: extract all digits
      const digitsOnly = ind.indentNumber.replace(/[^0-9]/g, '');
      if (digitsOnly) {
        const num = parseInt(digitsOnly, 10);
        if (!isNaN(num) && num < 100000000 && num > maxNum) {
          maxNum = num;
        }
      }
    }
  }
  return (maxNum + 1).toString();
};

// Indexes
indentSchema.index({ indentNumber: 1 });
indentSchema.index({ status: 1 });
indentSchema.index({ department: 1 });
indentSchema.index({ requestedBy: 1 });
indentSchema.index({ requestedDate: -1 });
indentSchema.index({ category: 1 });
indentSchema.index({ priority: 1 });

indentSchema.statics.updateFulfillment = async function (indentId) {
  const indent = await this.findById(indentId);
  if (!indent) return null;

  // Find all active POs for this indent
  const PurchaseOrder = mongoose.model('PurchaseOrder');
  const pos = await PurchaseOrder.find({
    indent: indentId,
    status: { $nin: ['Cancelled', 'Rejected'] }
  });

  // Calculate ordered quantity per item description
  const orderedQuantities = {};
  pos.forEach(po => {
    po.items.forEach(item => {
      const desc = (item.description || '').trim().toLowerCase();
      if (!orderedQuantities[desc]) {
        orderedQuantities[desc] = 0;
      }
      orderedQuantities[desc] += item.quantity;
    });
  });

  // Update indent items
  let allFulfilled = true;
  let anyFulfilled = false;

  indent.items.forEach(item => {
    const desc = (item.itemName || '').trim().toLowerCase();
    const orderedQty = orderedQuantities[desc] || 0;
    item.orderedQuantity = orderedQty;

    if (orderedQty >= item.quantity) {
      anyFulfilled = true;
    } else {
      allFulfilled = false;
      if (orderedQty > 0) anyFulfilled = true;
    }
  });

  // Only update status if it's currently in a state that can be fulfilled
  const fulfillableStatuses = ['Approved', 'Partially Fulfilled', 'Fulfilled'];
  if (fulfillableStatuses.includes(indent.status)) {
    if (allFulfilled && indent.items.length > 0) {
      indent.status = 'Fulfilled';
      indent.fulfilledDate = new Date();
    } else if (anyFulfilled) {
      indent.status = 'Partially Fulfilled';
    } else {
      indent.status = 'Approved'; // Revert back to approved if all POs were cancelled
    }
  }

  await indent.save();
  return indent;
};

module.exports = mongoose.model('Indent', indentSchema);

