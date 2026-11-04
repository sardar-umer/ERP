const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { runWithUser } = require('../utils/requestContext');
const { ROLE_MODULE_ACCESS } = require('../config/permissions');

// Helper functions
const sendError = (res, status, message) => res.status(status).json({ success: false, message });
const isDbError = (error) => 
  error.name === 'MongoTimeoutError' || 
  error.name === 'MongoNetworkError' || 
  error.message?.includes('timeout') || 
  error.message?.includes('connection');

// Normalize role name for comparison (handle case and spaces)
const normalizeRole = (role) => {
  if (!role) return '';
  return String(role).toLowerCase().replace(/\s+/g, '_');
};

// Get role config from permissions, checking multiple variations
const getRoleConfig = (role) => {
  if (!role) return null;
  return ROLE_MODULE_ACCESS[role] || 
         ROLE_MODULE_ACCESS[normalizeRole(role)] ||
         ROLE_MODULE_ACCESS[role.toLowerCase()] ||
         null;
};

const verifyToken = (token) => {
  try {
    return { decoded: jwt.verify(token, process.env.JWT_SECRET), error: null };
  } catch (error) {
    return { decoded: null, error };
  }
};

/** Max seconds after access-token expiry during which POST /auth/refresh-token may still issue a new token (sliding session). */
const REFRESH_GRACE_SEC = Math.max(
  60,
  parseInt(process.env.JWT_REFRESH_GRACE_SECONDS || String(7 * 24 * 60 * 60), 10)
);

/**
 * Like authMiddleware but allows an *expired* JWT within REFRESH_GRACE_SEC (for refresh-token only).
 * Prevents "logout mid long request" when the access JWT expires before the client gets a new one.
 */
const refreshAuthMiddleware = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    if (!token) return sendError(res, 401, 'Access denied. No token provided.');

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (jwtError) {
      if (jwtError.name === 'TokenExpiredError') {
        try {
          decoded = jwt.verify(token, process.env.JWT_SECRET, { ignoreExpiration: true });
        } catch {
          return sendError(res, 401, 'Invalid token.');
        }
        const now = Math.floor(Date.now() / 1000);
        if (decoded.exp && now - decoded.exp > REFRESH_GRACE_SEC) {
          return sendError(res, 401, 'Session expired. Please login again.');
        }
      } else {
        return sendError(res, 401, 'Invalid token.');
      }
    }

    const { user, error: dbError } = await fetchUser(decoded.userId);
    if (dbError) {
      if (isDbError(dbError)) {
        console.error('⚠️ Database error in refresh auth middleware:', dbError.message);
        return sendError(res, 503, 'Service temporarily unavailable. Please try again in a moment.');
      }
      throw dbError;
    }

    if (!user) return sendError(res, 401, 'Invalid token. User not found.');
    if (!user.isActive) return sendError(res, 401, 'Account is deactivated. Please contact administrator.');

    req.user = user;
    next();
  } catch (error) {
    console.error('Refresh auth middleware error:', error);
    return sendError(res, 500, 'Server error in authentication.');
  }
};

const fetchUser = async (userId) => {
  try {
    const user = await User.findById(userId)
      .select('-password')
      .populate('roleRef', 'name displayName description permissions isActive')
      .populate('roles', 'name displayName description permissions isActive')
      .populate('subRoles', 'name module permissions description')
      .maxTimeMS(5000);
    return { user, error: null };
  } catch (error) {
    return { user: null, error };
  }
};

const authMiddleware = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '') || req.query.token;
    if (!token) return sendError(res, 401, 'Access denied. No token provided.');

    // Verify JWT token
    const { decoded, error: jwtError } = verifyToken(token);
    if (jwtError) {
      if (jwtError.name === 'JsonWebTokenError') return sendError(res, 401, 'Invalid token.');
      if (jwtError.name === 'TokenExpiredError') return sendError(res, 401, 'Token expired. Please login again.');
      throw jwtError;
    }
    
    // Fetch user from database
    const { user, error: dbError } = await fetchUser(decoded.userId);
    if (dbError) {
      if (isDbError(dbError)) {
        console.error('⚠️ Database error in auth middleware:', dbError.message);
        return sendError(res, 503, 'Service temporarily unavailable. Please try again in a moment.');
      }
      throw dbError;
    }
    
    if (!user) return sendError(res, 401, 'Invalid token. User not found.');
    if (!user.isActive) return sendError(res, 401, 'Account is deactivated. Please contact administrator.');

    req.user = user;
    // Keep the acting user for the rest of the request (e.g. Employee change log)
    runWithUser(user, () => next());
  } catch (error) {
    console.error('Auth middleware error:', error);
    return sendError(res, 500, 'Server error in authentication.');
  }
};

// Optional auth middleware for routes that can work with or without authentication
const optionalAuth = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (token) {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.userId).select('-password');
      
      if (user && user.isActive) {
        req.user = user;
      }
    }
    
    next();
  } catch (error) {
    // Continue without authentication if token is invalid
    next();
  }
};

// Role-to-module mapping (shared constant)
const ROLE_TO_MODULE_MAP = {
  'hr_manager': 'hr',
  'finance_manager': 'finance',
  'recovery_manager': 'finance',
  'procurement_manager': 'procurement',
  /** Dedicated DC QA login (legacy user.role); maps to procurement for RBAC module checks. */
  'store_qa': 'procurement',
  'sales_manager': 'sales',
  'crm_manager': 'crm',
  'audit_manager': 'audit',
  'it_manager': 'it',
  'taj_residencia_manager': 'taj_residencia'
};

// Shared function to check if role has permission for required modules
const checkRoleModulePermissions = (role, normalizedAllowedRoles, requiredModules, isDev = false) => {
  if (!role || !role.isActive || !role.permissions || !Array.isArray(role.permissions)) {
    return false;
  }

  // Check if super_admin or admin is required (they have access to everything)
  if (normalizedAllowedRoles.includes('super_admin') || normalizedAllowedRoles.includes('admin')) {
    const hasAnyReadPermission = role.permissions.some(p => 
      p.actions && Array.isArray(p.actions) && p.actions.includes('read')
    );
    if (hasAnyReadPermission) {
      if (isDev) console.log(`🔒 [Backend] ✅ Access granted (any read permission)`);
      return true;
    }
  }

  // Check if role has permission for any required module
  const checkedModules = [];
  for (const requiredModule of requiredModules) {
    checkedModules.push(requiredModule);
    const modulePermission = role.permissions.find(p => p.module === requiredModule);
    if (modulePermission) {
      // Check module-level read permission
      const hasModuleRead = modulePermission.actions && Array.isArray(modulePermission.actions) && modulePermission.actions.includes('read');
      
      // Check submodule-level read permissions
      let hasSubmoduleRead = false;
      if (modulePermission.submodules && Array.isArray(modulePermission.submodules) && modulePermission.submodules.length > 0) {
        hasSubmoduleRead = modulePermission.submodules.some(sm => {
          if (typeof sm === 'object' && sm.actions && Array.isArray(sm.actions)) {
            return sm.actions.includes('read');
          }
          // If submodule is a string (legacy), module-level read applies
          if (typeof sm === 'string' && hasModuleRead) {
            return true;
          }
          return false;
        });
      }
      
      // Allow if either module-level or submodule-level read permission exists
      if (hasModuleRead || hasSubmoduleRead) {
        if (isDev) console.log(`🔒 [Backend] ✅ Access granted for module: ${requiredModule} (hasModuleRead: ${hasModuleRead}, hasSubmoduleRead: ${hasSubmoduleRead})`);
        return true;
      }
    }
  }

  if (isDev && checkedModules.length > 0) {
    console.log(`🔒 [Backend] ❌ No matching read access in required modules: ${checkedModules.join(', ')}`);
  }
  
  return false;
};

// Role-based authorization middleware
const authorize = (...roles) => {
  // Pre-normalize allowed roles once
  const normalizedAllowedRoles = roles.map(normalizeRole);
  const requiresHrManager = normalizedAllowedRoles.includes('hr_manager');
  const requiresAuditManager = normalizedAllowedRoles.includes('audit_manager');
  const isDev = process.env.NODE_ENV === 'development';
  
  // Map required roles to modules
  const requiredModules = normalizedAllowedRoles
    .map(r => ROLE_TO_MODULE_MAP[r])
    .filter(Boolean);
  
  return async (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Access denied. Authentication required.'
      });
    }

    const userRole = req.user.role;
    
    // Super Admin, Higher Management, and Developer have access to everything
    if (userRole === 'super_admin' || userRole === 'higher_management' || userRole === 'developer') {
      return next();
    }

    // NEW: Check roleRef permissions (RBAC system)
    // roleRef should be populated by authMiddleware
    const roleRef = req.user.roleRef;
    
    // If roleRef is populated and has permissions, check them
    if (roleRef && roleRef.permissions) {
      if (isDev) console.log(`🔒 [Backend] Checking roleRef: ${roleRef.name || roleRef.displayName || 'unknown'}`);
      if (checkRoleModulePermissions(roleRef, normalizedAllowedRoles, requiredModules, isDev)) {
        return next();
      }
    }
    
    // NEW: Check multiple roles permissions (RBAC system)
    // roles should be populated by authMiddleware
    const userRoles = req.user.roles;
    if (userRoles && Array.isArray(userRoles) && userRoles.length > 0) {
      if (isDev) console.log(`🔒 [Backend] Checking ${userRoles.length} role(s)`);
      for (const role of userRoles) {
        // Role should already be populated, but handle both cases
        if (role && role.permissions) {
          if (checkRoleModulePermissions(role, normalizedAllowedRoles, requiredModules, isDev)) {
            return next();
          }
        }
      }
    }

    // Check exact match (normalized)
    if (normalizedAllowedRoles.includes(normalizeRole(userRole))) {
      return next();
    }
    
    // If route requires hr_manager, check if user's role has HR module access
    if (requiresHrManager) {
      const roleConfig = getRoleConfig(userRole);
      if (roleConfig?.modules?.includes('hr')) {
        return next();
      }
    }
    
    // If route requires audit_manager, check if user's role has Audit module access
    if (requiresAuditManager) {
      const roleConfig = getRoleConfig(userRole);
      if (roleConfig?.modules?.includes('audit')) {
        return next();
      }
    }
    
    // Access denied
    return res.status(403).json({
      success: false,
      message: 'Access denied. Insufficient permissions.'
    });
  };
};

/**
 * Runs authorize(...) against a dummy response to see if the user would be allowed,
 * without sending a real HTTP response. Used to fall back to a narrower scope (e.g. own recovery rows).
 */
function tryAuthorize(req, ...roles) {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const dummyRes = {
      status() {
        return this;
      },
      json() {
        settle(false);
      }
    };
    const mw = authorize(...roles);
    try {
      const maybePromise = mw(req, dummyRes, () => settle(true));
      if (maybePromise && typeof maybePromise.catch === 'function') {
        maybePromise.catch(() => settle(false));
      }
    } catch {
      settle(false);
    }
  });
}

module.exports = {
  authMiddleware,
  refreshAuthMiddleware,
  optionalAuth,
  authorize,
  tryAuthorize
}; 