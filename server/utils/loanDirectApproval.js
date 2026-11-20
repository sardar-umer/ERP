/**
 * Loan – Direct Approval permission.
 * Granted by giving a role any action on HR → "loan_direct_approval" in Role Management
 * (super admin / developer always have it). Holders can create a loan that skips
 * GM HR → AVP → CEO and activate it themselves.
 */
const DIRECT_APPROVAL_SUBMODULE = 'loan_direct_approval';
const ALWAYS_ALLOWED = ['super_admin', 'developer'];

const roleGrants = (roleDoc) => {
  if (!roleDoc || typeof roleDoc !== 'object' || roleDoc.isActive === false) return false;
  const perms = Array.isArray(roleDoc.permissions) ? roleDoc.permissions : [];
  return perms.some((p) => {
    if (!p || String(p.module || '').toLowerCase() !== 'hr') return false;
    // Legacy flat format: { module, submodule, actions }
    const flat = String(p.submodule || p.subModule || '').toLowerCase();
    if (flat === DIRECT_APPROVAL_SUBMODULE) return (p.actions || []).length > 0;
    return (Array.isArray(p.submodules) ? p.submodules : []).some((sm) => {
      if (typeof sm === 'string') return sm === DIRECT_APPROVAL_SUBMODULE;
      return sm?.submodule === DIRECT_APPROVAL_SUBMODULE && Array.isArray(sm.actions) && sm.actions.length > 0;
    });
  });
};

const canDirectApproveLoan = (user) => {
  if (!user) return false;
  if (ALWAYS_ALLOWED.includes(user.role)) return true;
  if (roleGrants(user.roleRef)) return true;
  if (Array.isArray(user.roles) && user.roles.some(roleGrants)) return true;
  if (Array.isArray(user.subRoles) && user.subRoles.some(roleGrants)) return true;
  return false;
};

module.exports = { canDirectApproveLoan, DIRECT_APPROVAL_SUBMODULE };
