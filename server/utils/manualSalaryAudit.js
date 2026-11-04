/**
 * Manual Salary audit step (after AVP Taj, before Finance) — same lifecycle as Project IPCs in Pre-Audit:
 *   Pending Audit → (pre-audit staff) initial approval → forward → Forwarded to Audit Director
 *   → (Audit Director) final approval → Pending Finance (Finance → Payroll → Manual Salary pays it)
 * Audit can return it to HR at either level (→ Returned; HR edits and resubmits from GM HR).
 */
const ManualSalary = require('../models/hr/ManualSalary');
const User = require('../models/User');
const { hasAuditAccess, canPerformInitialPreAuditActions } = require('./auditAccess');
const { canActAsAuditDirector } = require('./auditDirectorRole');

/** Statuses Audit works on. "Approved by CEO" = approved under the old CEO flow, not yet audited. */
const AUDIT_QUEUE_STATUSES = ['Pending Audit', 'Forwarded to Audit Director', 'Approved by CEO'];

const fail = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });

const pushHistory = (record, fromStatus, toStatus, userId, comments, module = 'Pre-Audit') => {
  record.workflowHistory = record.workflowHistory || [];
  record.workflowHistory.push({ fromStatus, toStatus, changedBy: userId, changedAt: new Date(), comments, module });
};

const notifyRoles = async (roles, actorId, title, message, record, actionUrl) => {
  try {
    const { createAndEmitNotification } = require('../services/realtimeNotificationService');
    const users = await User.find({ isActive: true, role: { $in: roles } }).select('_id').lean();
    if (!users.length) return;
    await createAndEmitNotification({
      recipientIds: users.map((u) => String(u._id)),
      title,
      message,
      type: 'info',
      category: 'approval',
      priority: 'medium',
      actionUrl,
      createdBy: actorId,
      excludeUserId: actorId,
      metadata: { module: 'hr', entityId: record._id, entityType: 'ManualSalary' }
    });
  } catch (err) {
    console.error('Manual salary audit notification failed:', err.message);
  }
};

const label = (r) => `${r.name}${r.empId ? ` (${r.empId})` : ''} — ${r.month}/${r.year}`;

/** AVP (or legacy CEO) approval hands the record to Audit */
const sendToAudit = async (record, userId, comments = '') => {
  const from = record.workflowStatus;
  record.workflowStatus = 'Pending Audit';
  ['preAuditInitialApprovedBy', 'preAuditInitialApprovedAt', 'preAuditInitialComments',
    'auditForwardedBy', 'auditForwardedAt', 'auditApprovedBy', 'auditApprovedAt', 'auditComments']
    .forEach((k) => { record[k] = undefined; });
  pushHistory(record, from, 'Pending Audit', userId, comments || 'Sent to Audit', 'HR');
  await record.save();
  await notifyRoles(['auditor', 'audit_manager', 'super_admin'], userId, 'Manual salary waiting for audit',
    `Manual salary ${label(record)} is waiting in Pre-Audit.`, record, '/audit/pre-audit');
};

/** Initial approval (pre-audit staff) or final approval (Audit Director → Finance) */
const auditApprove = async (id, user, comments = '') => {
  if (!hasAuditAccess(user)) throw fail('Audit access required', 403);
  const record = await ManualSalary.findById(id);
  if (!record) throw fail('Record not found', 404);
  const uid = user._id || user.id;

  if (['Pending Audit', 'Approved by CEO'].includes(record.workflowStatus)) {
    if (!canPerformInitialPreAuditActions(user)) {
      throw fail('Initial approval is done by pre-audit staff, not the Audit Director', 403);
    }
    const from = record.workflowStatus;
    record.workflowStatus = 'Pending Audit';
    record.preAuditInitialApprovedBy = uid;
    record.preAuditInitialApprovedAt = new Date();
    record.preAuditInitialComments = comments;
    pushHistory(record, from, 'Pending Audit', uid, comments || 'Initial pre-audit approval recorded');
    await record.save();
    return { record, message: 'Initial pre-audit approval recorded. Forward to Audit Director for final approval.' };
  }

  if (record.workflowStatus !== 'Forwarded to Audit Director') {
    throw fail(`Manual salary is ${record.workflowStatus}, not with Audit`);
  }
  if (!canActAsAuditDirector(user)) throw fail('Only the Audit Director can give final audit approval', 403);
  record.workflowStatus = 'Pending Finance';
  record.auditApprovedBy = uid;
  record.auditApprovedAt = new Date();
  record.auditComments = comments;
  pushHistory(record, 'Forwarded to Audit Director', 'Pending Finance', uid, comments || 'Audit Director approved — sent to Finance');
  await record.save();
  await notifyRoles(['finance_manager', 'admin', 'super_admin'], uid, 'Manual salary ready for payment',
    `Manual salary ${label(record)} — PKR ${Number(record.netPayable || 0).toLocaleString()} is audit-approved and waiting in Finance → Payroll → Manual Salary.`,
    record, '/finance/payroll');
  return { record, message: 'Audit approved — sent to Finance for payment' };
};

const forwardToAuditDirector = async (id, user, comments = '') => {
  if (!canPerformInitialPreAuditActions(user)) {
    throw fail('Only General Audit / pre-audit staff can forward to Audit Director (not Audit Director).', 403);
  }
  const record = await ManualSalary.findById(id);
  if (!record) throw fail('Record not found', 404);
  if (record.workflowStatus === 'Forwarded to Audit Director') throw fail('Document is already forwarded to Audit Director');
  if (record.workflowStatus !== 'Pending Audit') throw fail(`Manual salary is ${record.workflowStatus}, not Pending Audit`);
  if (!record.preAuditInitialApprovedAt) throw fail('Initial pre-audit approval is required before forwarding to Audit Director.');
  const uid = user._id || user.id;
  record.workflowStatus = 'Forwarded to Audit Director';
  record.auditForwardedBy = uid;
  record.auditForwardedAt = new Date();
  pushHistory(record, 'Pending Audit', 'Forwarded to Audit Director', uid, comments || 'Forwarded to Audit Director for approval');
  await record.save();
  await notifyRoles(['audit_director', 'super_admin'], uid, 'Document forwarded to Audit Director',
    `Manual salary ${label(record)} is waiting for your approval.`, record, '/audit/pre-audit');
  return { record, message: 'Document forwarded to Audit Director successfully' };
};

/** Return / reject from Audit → back to HR (Returned) with comments and observations */
const auditReturn = async (id, user, { comments = '', observations = [] } = {}) => {
  if (!hasAuditAccess(user)) throw fail('Audit access required', 403);
  const record = await ManualSalary.findById(id);
  if (!record) throw fail('Record not found', 404);
  if (!AUDIT_QUEUE_STATUSES.includes(record.workflowStatus)) {
    throw fail(`Audit can only return a manual salary that is with Audit (now ${record.workflowStatus})`);
  }
  if (record.workflowStatus === 'Forwarded to Audit Director' && !canActAsAuditDirector(user)) {
    throw fail('Only the Audit Director can return a document forwarded to them', 403);
  }
  const text = String(comments || '').trim();
  const obs = (Array.isArray(observations) ? observations : [])
    .map((o) => ({ observation: String(o?.observation || o?.text || o || '').trim(), severity: o?.severity || 'medium' }))
    .filter((o) => o.observation);
  if (!text && !obs.length) throw fail('Write comments or at least one observation to return it');

  const uid = user._id || user.id;
  const from = record.workflowStatus;
  record.returnedFromStatus = from;
  record.workflowStatus = 'Returned';
  record.returnComments = `Audit: ${text || obs.map((o) => o.observation).join('; ')}`;
  record.rejectionComments = record.returnComments;
  obs.forEach((o) => record.auditObservations.push({ ...o, addedBy: uid, addedAt: new Date() }));
  ['preAuditInitialApprovedBy', 'preAuditInitialApprovedAt', 'preAuditInitialComments', 'auditForwardedBy', 'auditForwardedAt']
    .forEach((k) => { record[k] = undefined; });
  pushHistory(record, from, 'Returned', uid, record.returnComments);
  await record.save();
  if (record.initiator) {
    try {
      const { createAndEmitNotification } = require('../services/realtimeNotificationService');
      await createAndEmitNotification({
        recipientIds: [String(record.initiator)],
        title: 'Manual salary returned by Audit',
        message: `${label(record)}: ${record.returnComments}`,
        type: 'warning',
        category: 'approval',
        priority: 'medium',
        actionUrl: '/hr/payroll',
        createdBy: uid,
        excludeUserId: uid,
        metadata: { module: 'hr', entityId: record._id, entityType: 'ManualSalary' }
      });
    } catch (err) {
      console.error('Manual salary return notification failed:', err.message);
    }
  }
  return { record, message: 'Returned to HR with audit comments' };
};

/** Pre-Audit status key for the audit queue tabs */
const preAuditStatusOf = (r) => {
  if (r.workflowStatus === 'Forwarded to Audit Director') return 'forwarded_to_director';
  if (['Pending Finance', 'Payment Pending', 'Paid'].includes(r.workflowStatus)) return 'approved';
  if (r.workflowStatus === 'Returned' && ['Pending Audit', 'Forwarded to Audit Director', 'Approved by CEO'].includes(r.returnedFromStatus)) {
    return 'returned_with_observations';
  }
  return r.preAuditInitialApprovedAt ? 'under_review' : 'pending';
};

/** Rows for GET /api/pre-audit */
const listManualSalariesForPreAudit = async (search = '') => {
  const query = {
    $or: [
      { workflowStatus: { $in: AUDIT_QUEUE_STATUSES } },
      { workflowStatus: { $in: ['Pending Finance', 'Payment Pending', 'Paid'] }, auditApprovedAt: { $exists: true } },
      { workflowStatus: 'Returned', returnedFromStatus: { $in: AUDIT_QUEUE_STATUSES } }
    ]
  };
  if (search) {
    query.$and = [{ $or: [
      { name: { $regex: search, $options: 'i' } },
      { empId: { $regex: search, $options: 'i' } },
      { project: { $regex: search, $options: 'i' } }
    ] }];
  }
  const ppl = 'firstName lastName email digitalSignature';
  const docs = await ManualSalary.find(query)
    .populate('initiator', ppl).populate('hodApprovedBy', ppl).populate('avpApprovedBy', ppl).populate('ceoApprovedBy', ppl)
    .populate('preAuditInitialApprovedBy', ppl).populate('auditApprovedBy', ppl)
    .populate('workflowHistory.changedBy', 'firstName lastName email employeeId digitalSignature approvalStamp')
    .populate('auditObservations.addedBy', 'firstName lastName email')
    .sort({ updatedAt: -1 })
    .limit(500)
    .lean();
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return docs.map((doc) => {
    const period = `${MONTHS[(doc.month || 1) - 1]} ${doc.year}`;
    const number = `MSAL-${String(doc._id).slice(-6).toUpperCase()}`;
    return {
      _id: doc._id,
      documentNumber: number,
      title: `Manual Salary: ${doc.name}${doc.empId ? ` (${doc.empId})` : ''} — ${period}`,
      description: [doc.designation, doc.project, doc.companyName].filter(Boolean).join(' · ') || 'Manual salary',
      sourceModule: 'hr',
      sourceDepartmentName: 'HR — Manual Salary',
      companyName: doc.companyName || '',
      company: doc.companyName || '',
      sourceDepartment: null,
      documentType: 'Manual Salary',
      documentDate: doc.avpApprovedAt || doc.updatedAt || doc.createdAt,
      amount: doc.netPayable || 0,
      referenceNumber: number,
      status: preAuditStatusOf(doc),
      workflowStatus: doc.workflowStatus,
      priority: 'high',
      isWorkflowDocument: false,
      isPurchaseOrder: false,
      isCashApproval: false,
      isManualSalary: true,
      originalDocument: doc,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
      createdBy: doc.initiator,
      workflowHistory: doc.workflowHistory || [],
      auditObservations: doc.auditObservations || [],
      preAuditInitialApprovedAt: doc.preAuditInitialApprovedAt || null,
      initialAuditApproved: Boolean(doc.preAuditInitialApprovedAt),
      auditApprovedAt: doc.auditApprovedAt || null
    };
  });
};

module.exports = {
  AUDIT_QUEUE_STATUSES,
  sendToAudit,
  auditApprove,
  forwardToAuditDirector,
  auditReturn,
  listManualSalariesForPreAudit
};
