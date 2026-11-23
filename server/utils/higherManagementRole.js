/**
 * higher_management role: full access until it is saved in Role Management (Role.enforcePermissions = true).
 * After that its users get only what is ticked on the role (plus any other roles they hold).
 *
 * loadHigherManagementRole() keeps config/permissions' state current (cached 30 s per server process);
 * attachHigherManagementRole(user) adds the role to user.roles in memory, so every check that reads
 * user.roles (server routes and the client sidebar) sees its permissions.
 */
const Role = require('../models/Role');
const { setHigherManagementState } = require('../config/permissions');

const CACHE_MS = 30 * 1000;
let cache = { at: 0, role: null };

const loadHigherManagementRole = async () => {
  if (Date.now() - cache.at < CACHE_MS) return cache.role;
  try {
    const role = await Role.findOne({ name: 'higher_management' })
      .select('name displayName description permissions isActive enforcePermissions')
      .maxTimeMS(5000);
    cache = { at: Date.now(), role };
    setHigherManagementState(role ? role.toObject() : null);
  } catch (err) {
    // Keep the last known state; never block a request because of this lookup
    console.error('higher_management role lookup failed:', err.message);
  }
  return cache.role;
};

const clearHigherManagementRoleCache = () => {
  cache = { at: 0, role: null };
};

/** For a higher_management user whose role is restricted: put the role on user.roles (not saved). */
const attachHigherManagementRole = async (user) => {
  if (!user || user.role !== 'higher_management') return user;
  const role = await loadHigherManagementRole();
  const enforced = Boolean(role && role.enforcePermissions);
  if (user.$locals) user.$locals.hmPermissionsEnforced = enforced;
  if (!enforced) return user;
  const has = (user.roles || []).some((r) => String(r?._id || r) === String(role._id));
  if (!has) {
    if (!Array.isArray(user.roles)) user.roles = [];
    user.roles.push(role);
  }
  return user;
};

module.exports = { loadHigherManagementRole, clearHigherManagementRoleCache, attachHigherManagementRole };
