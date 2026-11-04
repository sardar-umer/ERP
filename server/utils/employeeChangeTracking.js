/**
 * Employee change log: every save / single-document update of an employee records the tracked fields
 * that changed (old → new, as readable text), who made the change and when, in EmployeeChangeLog.
 * Works for the HR edit form and every other place that updates an employee (imports, settlements, …).
 */
const mongoose = require('mongoose');
const { currentUserId } = require('./requestContext');

const ALLOWANCES = [
  ['conveyance', 'Conveyance Allowance'],
  ['food', 'Food Allowance'],
  ['mobile', 'Mobile Allowance'],
  ['vehicle', 'Vehicle Allowance'],
  ['fuel', 'Fuel Allowance'],
  ['vehicleFuel', 'Vehicle & Fuel Allowance'],
  ['medical', 'Medical Allowance'],
  ['houseRent', 'House Rent Allowance'],
  ['special', 'Special Allowance'],
  ['other', 'Other Allowance']
];

/** path → { label, ref?: model name, kind?: 'date'|'money'|'bool'|'allowance'|'json' } */
const TRACKED = {
  employeeId: { label: 'Employee ID' },
  firstName: { label: 'First Name' },
  lastName: { label: 'Last Name' },
  email: { label: 'Email' },
  phone: { label: 'Phone' },
  idCard: { label: 'CNIC' },
  employmentStatus: { label: 'Employment Status' },
  employmentType: { label: 'Employment Type' },
  employeeCategory: { label: 'Employee Category' },
  isActive: { label: 'Active', kind: 'bool' },
  placementCompany: { label: 'Company', ref: 'PlacementCompany' },
  placementSector: { label: 'Sector', ref: 'Sector' },
  placementProject: { label: 'Project', ref: 'Project' },
  placementDepartment: { label: 'Department', ref: 'Department' },
  placementSection: { label: 'Section', ref: 'Section' },
  placementDesignation: { label: 'Designation', ref: 'Designation' },
  placementLocation: { label: 'Location', ref: 'Location' },
  manager: { label: 'Manager', ref: 'Employee' },
  hod: { label: 'Head of Department', ref: 'Employee' },
  reportingLine: { label: 'Reporting To', ref: 'Employee' },
  hireDate: { label: 'Hire Date', kind: 'date' },
  appointmentDate: { label: 'Appointment Date', kind: 'date' },
  confirmationDate: { label: 'Confirmation Date', kind: 'date' },
  terminationDate: { label: 'Leaving Date', kind: 'date' },
  terminationReason: { label: 'Leaving Reason' },
  'salary.gross': { label: 'Gross Salary', kind: 'money' },
  'salary.basic': { label: 'Basic Salary', kind: 'money' },
  bankName: { label: 'Bank' },
  bankAccountNumber: { label: 'Bank Account' },
  cashSalary: { label: 'Cash Salary', kind: 'bool' },
  taxExemption: { label: 'Tax Exemption', kind: 'bool' },
  manualTax: { label: 'Manual Tax', kind: 'json' },
  partialSalaryPay: { label: 'Partial Salary Pay', kind: 'json' },
  ...Object.fromEntries(ALLOWANCES.map(([key, label]) => [`allowances.${key}`, { label, kind: 'allowance' }]))
};
const TRACKED_PATHS = Object.keys(TRACKED);
const SELECT = [...new Set(TRACKED_PATHS.map((p) => p.split('.')[0]))].join(' ');

const getPath = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
const refId = (v) => (v == null ? '' : String(v._id || v));

/** Comparable raw value for a tracked path. */
const rawValue = (doc, path) => {
  const v = getPath(doc, path);
  const { kind, ref } = TRACKED[path];
  if (ref) return refId(v);
  if (kind === 'date') return v ? new Date(v).toISOString().slice(0, 10) : '';
  if (kind === 'allowance') return v?.isActive && Number(v.amount) > 0 ? String(Math.round(Number(v.amount) * 100) / 100) : '0';
  if (kind === 'money') return v == null || v === '' ? '' : String(Math.round(Number(v) * 100) / 100);
  if (kind === 'bool') return v ? 'Yes' : 'No';
  if (kind === 'json') {
    if (!v) return '';
    const plain = typeof v.toObject === 'function' ? v.toObject() : v;
    return JSON.stringify(plain, (k, val) => (k === '_id' ? undefined : val));
  }
  return v == null ? '' : String(v).trim();
};

const refLabel = async (model, id) => {
  if (!id) return '';
  try {
    const d = await mongoose.model(model).findById(id).select('name title firstName lastName employeeId').lean();
    if (!d) return id;
    if (model === 'Employee') return [[d.firstName, d.lastName].filter(Boolean).join(' '), d.employeeId ? `(${d.employeeId})` : ''].filter(Boolean).join(' ');
    return d.name || d.title || id;
  } catch {
    return id;
  }
};

const money = (v) => (v === '' ? '' : Number(v).toLocaleString('en-PK', { maximumFractionDigits: 2 }));

const display = async (path, raw) => {
  const { kind, ref } = TRACKED[path];
  if (ref) return refLabel(ref, raw);
  if (kind === 'money' || kind === 'allowance') return raw === '' ? '' : (raw === '0' && kind === 'allowance' ? 'None' : money(raw));
  if (path === 'manualTax' && raw) {
    const m = JSON.parse(raw);
    return m.isActive ? `Fixed ${money(m.fixedAmount || 0)}` : 'Off';
  }
  if (path === 'partialSalaryPay' && raw) {
    const p = JSON.parse(raw);
    if (!p.isActive) return 'Off';
    const months = (p.periods || []).map((x) => `${String(x.month).padStart(2, '0')}/${x.year}`).join(', ');
    return `${p.payableDaysPerMonth} days/month${months ? ` (${months})` : ''}`;
  }
  return raw;
};

/** Compare two snapshots and save one log entry with every changed tracked field. */
const recordChanges = async (employeeId, before, after) => {
  if (!before || !after) return;
  const changes = [];
  for (const path of TRACKED_PATHS) {
    const a = rawValue(before, path);
    const b = rawValue(after, path);
    if (a === b) continue;
    // Off ↔ unset is not a change
    if (TRACKED[path].kind === 'json' && [a, b].every((x) => !x || !JSON.parse(x).isActive)) continue;
    changes.push({ field: path, label: TRACKED[path].label, from: await display(path, a), to: await display(path, b) });
  }
  if (!changes.length) return;
  await mongoose.model('EmployeeChangeLog').create({ employee: employeeId, changedBy: currentUserId(), changedAt: new Date(), changes });
};

const safely = (fn) => fn().catch((err) => console.error('Employee change log:', err.message));

function employeeChangeTracking(schema) {
  schema.pre('save', async function trackBeforeSave() {
    if (this.isNew) return;
    this.$locals.changeLogBefore = await this.constructor.findById(this._id).select(SELECT).lean();
  });
  schema.post('save', function trackAfterSave(doc) {
    const before = doc.$locals?.changeLogBefore;
    if (!before) return;
    doc.$locals.changeLogBefore = null;
    safely(() => recordChanges(doc._id, before, doc.toObject()));
  });

  for (const op of ['findOneAndUpdate', 'updateOne']) {
    schema.pre(op, async function trackBeforeUpdate() {
      if (this.getOptions()?.skipChangeLog) return;
      this._changeLogBefore = await this.model.findOne(this.getFilter()).select(SELECT).lean();
    });
    schema.post(op, function trackAfterUpdate() {
      const before = this._changeLogBefore;
      if (!before) return;
      const Model = this.model;
      safely(async () => {
        const after = await Model.findById(before._id).select(SELECT).lean();
        await recordChanges(before._id, before, after);
      });
    });
  }
}

module.exports = { employeeChangeTracking, TRACKED };
