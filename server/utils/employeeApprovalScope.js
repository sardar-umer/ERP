/**
 * "Approval not given" employees (Employee.approvalNotGiven = true) are left out of every Employee list,
 * count and aggregate — payroll, attendance, leaves, loans, KPI, HR / payroll reports, dashboards, dropdowns —
 * as if they were not part of the company yet.
 *
 * Not hidden (so records and HR can still reach them):
 *   - lookups of one person: a filter on _id, employeeId, idCard, email or user with an exact value
 *     (employee page, populate on old payrolls / loans / settlements, duplicate checks, updates)
 *   - a filter that names approvalNotGiven itself (the Employees list "Approval not given" filter)
 *   - queries run with the option { includeUnapproved: true } (e.g. next employee ID)
 */
const IDENTITY_KEYS = ['_id', 'employeeId', 'idCard', 'email', 'user'];
const HIDE = { approvalNotGiven: { $ne: true } };

const isExactValue = (v) => {
  if (v === null || v === undefined) return false;
  if (v instanceof RegExp) return false;
  if (typeof v === 'object' && !Array.isArray(v) && v.constructor === Object) {
    if (v.$regex !== undefined) return false;
    // { $in: [...] } / { $eq: x } are exact; { $ne } / { $exists } / { $nin } are not
    return v.$in !== undefined || v.$eq !== undefined;
  }
  return true; // string, ObjectId, number
};

/** True when the filter targets specific people or approvalNotGiven itself */
const filterIsScoped = (filter, depth = 0) => {
  if (!filter || typeof filter !== 'object' || depth > 4) return false;
  if (Object.prototype.hasOwnProperty.call(filter, 'approvalNotGiven')) return true;
  if (IDENTITY_KEYS.some((k) => Object.prototype.hasOwnProperty.call(filter, k) && isExactValue(filter[k]))) return true;
  if (Array.isArray(filter.$and) && filter.$and.some((f) => filterIsScoped(f, depth + 1))) return true;
  // $or: scoped only when every branch is (e.g. duplicate check on employeeId OR idCard)
  if (Array.isArray(filter.$or) && filter.$or.length && filter.$or.every((f) => filterIsScoped(f, depth + 1))) return true;
  return false;
};

function employeeApprovalScope(schema) {
  const queryHook = function () {
    if (this.getOptions().includeUnapproved) return;
    const filter = this.getFilter();
    if (filterIsScoped(filter)) return;
    this.where(HIDE);
  };
  ['find', 'findOne', 'countDocuments', 'count', 'distinct', 'findOneAndUpdate'].forEach((op) => {
    schema.pre(op, queryHook);
  });

  schema.pre('aggregate', function () {
    if (this.options && this.options.includeUnapproved) return;
    const pipeline = this.pipeline();
    const first = pipeline[0] || {};
    if (first.$geoNear || first.$search || first.$searchMeta) return;
    if (first.$match && filterIsScoped(first.$match)) return;
    pipeline.unshift({ $match: HIDE });
  });
}

/**
 * For records kept in other collections (e.g. Attendance): a match clause that leaves out "approval not given"
 * employees — { $and: [{ <field>: { $nin: ids } }] }, or {} when there are none. Spread it into a filter / $match.
 */
async function excludeApprovalNotGiven(field = 'employee') {
  const Employee = require('mongoose').model('Employee');
  const ids = await Employee.distinct('_id', { approvalNotGiven: true });
  return ids.length ? { $and: [{ [field]: { $nin: ids } }] } : {};
}

module.exports = { employeeApprovalScope, filterIsScoped, excludeApprovalNotGiven };
