const mongoose = require('mongoose');

const roleSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true
  },
  displayName: {
    type: String,
    trim: true
    // Defaults to name in pre-save when not provided
  },
  description: {
    type: String,
    trim: true,
    default: ''
  },
  permissions: [{
    module: {
      type: String,
      required: true,
      trim: true
    },
    // Support both formats: array of strings (legacy) or array of objects with actions
    submodules: [{
      type: mongoose.Schema.Types.Mixed // Can be String or { submodule: String, actions: [String] }
    }],
    // Module-level actions (for backward compatibility)
    actions: [{
      type: String,
      enum: ['create', 'read', 'update', 'delete', 'approve', 'export', 'import', 'view', 'manage']
    }]
  }],
  isActive: {
    type: Boolean,
    default: true
  },
  isSystemRole: {
    type: Boolean,
    default: false // System roles cannot be deleted
  },
  /** higher_management only: once saved from Role Management, its ticked permissions apply instead of full access */
  enforcePermissions: {
    type: Boolean,
    default: false
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
    // Not required for system roles
  },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true
});

// Index for better performance
roleSchema.index({ name: 1 });
roleSchema.index({ isActive: 1 });

// Virtual for user count
roleSchema.virtual('userCount', {
  ref: 'User',
  localField: '_id',
  foreignField: 'role',
  count: true
});

// Method to check if role has permission for a specific module
roleSchema.methods.hasModulePermission = function(module) {
  return this.permissions.some(permission => permission.module === module);
};

// Method to check if role has permission for a specific submodule
roleSchema.methods.hasSubmodulePermission = function(module, submodule) {
  const modulePermission = this.permissions.find(p => p.module === module);
  if (!modulePermission) return false;
  
  // Check if submodule exists (support both string and object formats)
  return modulePermission.submodules.some(sm => {
    if (typeof sm === 'string') return sm === submodule;
    if (sm && typeof sm === 'object') return sm.submodule === submodule;
    return false;
  });
};

// Method to check if role has permission for a specific action
roleSchema.methods.hasActionPermission = function(module, submodule, action) {
  const modulePermission = this.permissions.find(p => p.module === module);
  if (!modulePermission) return false;
  
  // If submodule is provided, check per-submodule actions
  if (submodule && modulePermission.submodules && modulePermission.submodules.length > 0) {
    // Find the submodule (support both string and object formats)
    const submoduleEntry = modulePermission.submodules.find(sm => {
      if (typeof sm === 'string') return sm === submodule;
      if (sm && typeof sm === 'object') return sm.submodule === submodule;
      return false;
    });
    
    if (submoduleEntry) {
      // If it's an object with actions array, check those actions
      if (submoduleEntry && typeof submoduleEntry === 'object' && Array.isArray(submoduleEntry.actions)) {
        return submoduleEntry.actions.includes(action);
      }
      // If it's a string (legacy format), check module-level actions
      if (typeof submoduleEntry === 'string') {
        return modulePermission.actions.includes(action);
      }
    }
  }
  
  // If no submodule specified or submodules array is empty, check module-level actions
  return modulePermission.actions.includes(action);
};

// Method to get all allowed modules for this role
roleSchema.methods.getAllowedModules = function() {
  return this.permissions.map(p => p.module);
};

// Method to get all allowed submodules for a specific module
roleSchema.methods.getAllowedSubmodules = function(module) {
  const modulePermission = this.permissions.find(p => p.module === module);
  if (!modulePermission) return [];
  
  // Extract submodule names (support both formats)
  return modulePermission.submodules.map(sm => {
    if (typeof sm === 'string') return sm;
    if (sm && typeof sm === 'object') return sm.submodule;
    return null;
  }).filter(Boolean);
};

// Method to get all allowed actions for a specific module and submodule
roleSchema.methods.getAllowedActions = function(module, submodule) {
  const modulePermission = this.permissions.find(p => p.module === module);
  if (!modulePermission) return [];
  
  // Find the submodule entry
  const submoduleEntry = modulePermission.submodules.find(sm => {
    if (typeof sm === 'string') return sm === submodule;
    if (sm && typeof sm === 'object') return sm.submodule === submodule;
    return false;
  });
  
  if (submoduleEntry) {
    // If it's an object with actions array, return those actions
    if (submoduleEntry && typeof submoduleEntry === 'object' && Array.isArray(submoduleEntry.actions)) {
      return submoduleEntry.actions;
    }
    // If it's a string (legacy format), return module-level actions
    if (typeof submoduleEntry === 'string') {
      return modulePermission.actions;
    }
  }
  
  return [];
};

// Normalize permissions so stringified values (e.g. from production proxies) never cause CastError
function ensureArray(val) {
  if (val == null) return [];
  if (Array.isArray(val)) return val;
  if (typeof val === 'string') {
    const s = val.trim();
    if (!s.startsWith('[') && !s.startsWith('{')) return [];
    try {
      const parsed = JSON.parse(s);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      try {
        const jsonLike = s.replace(/(\w+):\s*/g, '"$1": ').replace(/'/g, '"');
        const parsed = JSON.parse(jsonLike);
        return Array.isArray(parsed) ? parsed : [];
      } catch (__) {
        return [];
      }
    }
  }
  return [];
}

function normalizeSubmodule(sm) {
  if (sm == null) return null;
  if (typeof sm === 'string') {
    return { submodule: sm, actions: [] };
  }
  if (typeof sm === 'object' && sm.submodule) {
    return {
      submodule: String(sm.submodule),
      actions: Array.isArray(sm.actions) ? sm.actions.filter((a) => typeof a === 'string') : []
    };
  }
  return null;
}

// Pre-save middleware: lowercase name, default displayName to name, normalize permissions
roleSchema.pre('save', function(next) {
  if (this.isModified('name')) {
    this.name = this.name.toLowerCase();
  }
  if (!this.displayName || !this.displayName.trim()) {
    this.displayName = this.name;
  }
  // Normalize permissions so submodules/actions are always arrays (fixes production stringified payloads)
  if (this.permissions && Array.isArray(this.permissions)) {
    this.permissions = this.permissions.map((p) => {
      if (!p || !p.module) return p;
      const submodulesRaw = ensureArray(p.submodules);
      const actionsRaw = ensureArray(p.actions);
      return {
        module: p.module,
        actions: actionsRaw.filter((a) => typeof a === 'string'),
        submodules: submodulesRaw.map(normalizeSubmodule).filter(Boolean)
      };
    });
  }
  next();
});

// Pre-remove middleware to prevent deletion of system roles
roleSchema.pre('remove', function(next) {
  if (this.isSystemRole) {
    const error = new Error('Cannot delete system role');
    error.statusCode = 400;
    return next(error);
  }
  next();
});

module.exports = mongoose.model('Role', roleSchema);
