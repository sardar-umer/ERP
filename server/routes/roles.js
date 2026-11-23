const express = require('express');
const router = express.Router();
const Role = require('../models/Role');
const User = require('../models/User');
const { authMiddleware } = require('../middleware/auth');
const permissions = require('../middleware/permissions');
const { asyncHandler } = require('../middleware/errorHandler');
const { clearHigherManagementRoleCache } = require('../utils/higherManagementRole');

// Parse JSON or JS-style (single-quoted, unquoted keys) string to array; production proxies sometimes send the latter
function parseJsonOrJsArray(val) {
  if (val == null) return [];
  if (Array.isArray(val)) return val;
  if (typeof val !== 'string') return [];
  const s = val.trim();
  if (!s.startsWith('[') && !s.startsWith('{')) return [];
  try {
    const parsed = JSON.parse(s);
    return Array.isArray(parsed) ? parsed : (parsed && typeof parsed === 'object' ? [parsed] : []);
  } catch (_) {
    try {
      let jsonLike = s
        .replace(/(\w+):\s*/g, '"$1": ')  // unquoted keys -> "key":
        .replace(/'/g, '"');               // single quotes -> double (values)
      const parsed = JSON.parse(jsonLike);
      return Array.isArray(parsed) ? parsed : (parsed && typeof parsed === 'object' ? [parsed] : []);
    } catch (__) {
      return [];
    }
  }
}

// Helps confirm production is running latest code (check response headers)
router.use((req, res, next) => {
  res.setHeader('X-Roles-Parser', 'v4-2026-02-16');
  next();
});

// Get all roles
router.get('/', 
  authMiddleware,
  permissions.checkSubRolePermission('admin', 'sub_roles', 'read'),
  asyncHandler(async (req, res) => {
    const { page = 1, limit = 10, search = '', isActive } = req.query;
    
    // Build query
    const query = {};
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { displayName: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } }
      ];
    }
    if (isActive !== undefined) {
      query.isActive = isActive === 'true';
    }
    
    const roles = await Role.find(query)
      .populate('createdBy', 'firstName lastName')
      .populate('updatedBy', 'firstName lastName')
      .populate('userCount')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);
    
    const total = await Role.countDocuments(query);
    
    res.json({
      success: true,
      data: {
        roles,
        pagination: {
          current: parseInt(page),
          pages: Math.ceil(total / limit),
          total
        }
      }
    });
  })
);

// Get role by ID
router.get('/:id',
  authMiddleware,
  permissions.checkSubRolePermission('admin', 'sub_roles', 'read'),
  asyncHandler(async (req, res) => {
    const role = await Role.findById(req.params.id)
      .populate('createdBy', 'firstName lastName')
      .populate('updatedBy', 'firstName lastName')
      .populate('userCount');
    
    if (!role) {
      return res.status(404).json({
        success: false,
        message: 'Role not found'
      });
    }
    
    res.json({
      success: true,
      data: { role }
    });
  })
);

// Create new role
router.post('/',
  authMiddleware,
  permissions.checkSubRolePermission('admin', 'sub_roles', 'create'),
  asyncHandler(async (req, res) => {
    let body = req.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch (e) {
        return res.status(400).json({ success: false, message: 'Invalid JSON body' });
      }
    }
    if (!body || typeof body !== 'object') {
      return res.status(400).json({ success: false, message: 'Request body is required' });
    }
    const { name, displayName, description, permissions: rolePermissions, isActive = true } = body;
    
    // Validate required fields (displayName defaults to name)
    if (!name) {
      return res.status(400).json({
        success: false,
        message: 'Role name is required'
      });
    }
    const effectiveDisplayName = displayName && displayName.trim() ? displayName.trim() : name;
    
    // Check if role already exists
    const existingRole = await Role.findOne({ name: name.toLowerCase() });
    if (existingRole) {
      return res.status(400).json({
        success: false,
        message: 'Role with this name already exists'
      });
    }
    
    // Validate and transform permissions structure
    let cleanedPermissions = [];
    let permsList = parseJsonOrJsArray(rolePermissions);
    if (permsList.length > 0) {
      for (const permission of permsList) {
        if (!permission || !permission.module) {
          return res.status(400).json({
            success: false,
            message: 'Invalid permission structure: module is required'
          });
        }
        
        // Transform submodules format; support string (including single-quoted from proxies)
        let transformedSubmodules = [];
        let submodulesRaw = parseJsonOrJsArray(permission.submodules);
        if (submodulesRaw && Array.isArray(submodulesRaw)) {
          transformedSubmodules = submodulesRaw.map(sm => {
            if (sm && typeof sm === 'object' && sm.submodule) {
              return {
                submodule: String(sm.submodule),
                actions: Array.isArray(sm.actions) ? sm.actions.filter((a) => typeof a === 'string') : []
              };
            }
            if (typeof sm === 'string') {
              return { submodule: String(sm), actions: [] };
            }
            return null;
          }).filter(Boolean);
        }
        
        const hasModuleActions = permission.actions && Array.isArray(permission.actions) && permission.actions.length > 0;
        const hasSubmoduleActions = transformedSubmodules.some(sm => sm && sm.actions && sm.actions.length > 0);
        
        if (hasModuleActions || hasSubmoduleActions || transformedSubmodules.length > 0) {
          const actionsList = parseJsonOrJsArray(permission.actions).filter((a) => typeof a === 'string');
          cleanedPermissions.push({
            module: String(permission.module),
            actions: actionsList,
            submodules: transformedSubmodules
          });
        }
      }
    }
    
    const role = new Role({
      name: name.toLowerCase(),
      displayName: effectiveDisplayName,
      description: description || '',
      permissions: cleanedPermissions,
      isActive,
      createdBy: req.user.id
    });
    
    await role.save();
    
    // Populate the created role
    const populatedRole = await Role.findById(role._id)
      .populate('createdBy', 'firstName lastName');
    
    res.status(201).json({
      success: true,
      message: 'Role created successfully',
      data: { role: populatedRole }
    });
  })
);

// Update role
router.put('/:id',
  authMiddleware,
  permissions.checkSubRolePermission('admin', 'sub_roles', 'update'),
  asyncHandler(async (req, res) => {
    let body = req.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch (e) {
        return res.status(400).json({ success: false, message: 'Invalid JSON body' });
      }
    }
    body = body && typeof body === 'object' ? body : {};
    const { displayName, description, permissions: rolePermissions, isActive } = body;
    
    const role = await Role.findById(req.params.id);
    if (!role) {
      return res.status(404).json({
        success: false,
        message: 'Role not found'
      });
    }
    
    // System roles are locked, except higher_management (its permissions can be edited)
    const isHigherManagement = role.name === 'higher_management';
    if (role.isSystemRole && !isHigherManagement) {
      return res.status(400).json({
        success: false,
        message: 'Cannot update system role'
      });
    }
    
    // Validate and transform permissions structure
    if (rolePermissions !== undefined) {
      let cleanedPermissions = [];
      let permsList = parseJsonOrJsArray(rolePermissions);
      if (permsList.length > 0) {
        for (const permission of permsList) {
          if (!permission || !permission.module) {
            return res.status(400).json({
              success: false,
              message: 'Invalid permission structure: module is required'
            });
          }
          
          let transformedSubmodules = [];
          let submodulesRaw = parseJsonOrJsArray(permission.submodules);
          if (submodulesRaw.length > 0) {
            transformedSubmodules = submodulesRaw.map(sm => {
              if (sm && typeof sm === 'object' && sm.submodule) {
                return {
                  submodule: String(sm.submodule),
                  actions: Array.isArray(sm.actions) ? sm.actions.filter((a) => typeof a === 'string') : []
                };
              }
              if (typeof sm === 'string') {
                return { submodule: String(sm), actions: [] };
              }
              return null;
            }).filter(Boolean);
          }
          
          const hasModuleActions = permission.actions && Array.isArray(permission.actions) && permission.actions.length > 0;
          const hasSubmoduleActions = transformedSubmodules.some(sm => sm && sm.actions && sm.actions.length > 0);
          
          if (hasModuleActions || hasSubmoduleActions || transformedSubmodules.length > 0) {
            const actionsList = parseJsonOrJsArray(permission.actions).filter((a) => typeof a === 'string');
            cleanedPermissions.push({
              module: String(permission.module),
              actions: actionsList,
              submodules: transformedSubmodules
            });
          }
        }
      }
      role.permissions = cleanedPermissions;
    }
    
    // Update fields
    if (displayName !== undefined) role.displayName = displayName;
    if (description !== undefined) role.description = description;
    if (isActive !== undefined && !isHigherManagement) role.isActive = isActive;
    if (isHigherManagement && rolePermissions !== undefined) role.enforcePermissions = true;
    role.updatedBy = req.user.id;
    
    await role.save();
    if (isHigherManagement) clearHigherManagementRoleCache();
    
    // Populate the updated role
    const populatedRole = await Role.findById(role._id)
      .populate('createdBy', 'firstName lastName')
      .populate('updatedBy', 'firstName lastName');
    
    res.json({
      success: true,
      message: 'Role updated successfully',
      data: { role: populatedRole }
    });
  })
);

// Delete role
router.delete('/:id',
  authMiddleware,
  permissions.checkSubRolePermission('admin', 'sub_roles', 'delete'),
  asyncHandler(async (req, res) => {
    const role = await Role.findById(req.params.id);
    if (!role) {
      return res.status(404).json({
        success: false,
        message: 'Role not found'
      });
    }
    
    // Prevent deleting system roles
    if (role.isSystemRole) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete system role'
      });
    }
    
    // Check if role is assigned to any users
    const userCount = await User.countDocuments({ role: role.name });
    if (userCount > 0) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete role. It is assigned to ${userCount} user(s)`
      });
    }
    
    await Role.findByIdAndDelete(req.params.id);
    
    res.json({
      success: true,
      message: 'Role deleted successfully'
    });
  })
);

// Get available modules and submodules for role creation
router.get('/modules/available',
  authMiddleware,
  permissions.checkSubRolePermission('admin', 'sub_roles', 'read'),
  asyncHandler(async (req, res) => {
    const { SUBMODULES, MODULES } = require('../config/permissions');
    
    const availableModules = Object.keys(SUBMODULES).map(moduleKey => ({
      key: moduleKey,
      name: MODULES[moduleKey] || moduleKey,
      submodules: SUBMODULES[moduleKey] || []
    }));
    
    res.json({
      success: true,
      data: { modules: availableModules }
    });
  })
);

// Get users assigned to a specific role
router.get('/:id/users',
  authMiddleware,
  permissions.checkSubRolePermission('admin', 'sub_roles', 'read'),
  asyncHandler(async (req, res) => {
    const role = await Role.findById(req.params.id);
    if (!role) {
      return res.status(404).json({
        success: false,
        message: 'Role not found'
      });
    }
    
    const users = await User.find({ role: role.name })
      .select('firstName lastName email isActive createdAt')
      .sort({ createdAt: -1 });
    
    res.json({
      success: true,
      data: { users }
    });
  })
);

module.exports = router;
