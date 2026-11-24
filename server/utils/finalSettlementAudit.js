/**
 * Final Settlement audit step (since 2026-11-24, replaces AVP): HR → GM HR → Audit → CEO → Finance.
 * Same lifecycle as Manual Salary / Project IPCs in the Pre-Audit screen:
 *   Pending Audit → (pre-audit staff) initial approval → forward → Forwarded to Audit Director
 *   → (Audit Director) final approval → Forwarded to CEO
 * Audit can return it to HR at either level (→ Returned; HR edits and forwards again).
 */
const FinalSettlement = require('../models/hr/FinalSettlement');
const User = require('../models/User');
const { hasAuditAccess, canPerformInitialPreAuditActions } = require('./auditAccess');
const { canActAsAuditDirector } = require('./auditDirectorRole');

const AUDIT_QUEUE_STATUSES = ['Pending Audit', 'Forwarded to Audit Director'];
const AUDIT_FIELDS = ['preAuditInitialApprovedBy', 'preAuditInitialApprovedAt', 'preAuditInitialComments',
  'auditForwardedBy', 'auditForwardedAt', 'auditApprovedBy', 'auditApprovedAt', 'auditComments'];

const fail = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });

const pushHistory = (record, fromStatus, toStatus, userId, comments, module = 'Pre-Audit') => {
  record.workflowHistory = record.workflowHistory || [];
  record.workflowHistory.push({ fromStatus, toStatus, changedBy: userId, changedAt: new Date(), comments, module });
};

const notify = async ({ recipientIds, roles, actorId, title, message, record, actionUrl, type = 'info' }) => {
  try {
    const { createAndEmitNotification } = require('../services/realtimeNotificationService');
    let ids = (recipientIds || []).filter(Boolean).map(String);
    if (roles?.length) {
      const users = await User.find({ isActive: true, role: { $in: roles } }).select('_id').lean();
      ids = ids.concat(users.map((u) => String(u._id)));
    }
    ids = [...new Set(ids)];
    if (!ids.length) return;
    await createAndEmitNotification({
      recipientIds: ids,
      title,
      message,
      type,
      category: 'approval',
      priority: 'medium',
      actionUrl,
      createdBy: actorId,
      excludeUserId: actorId,
      metadata: { module: 'hr', entityId: record._id, entityType: 'FinalSettlement' }
    });
  } catch (err) {
    console.error('Final settlement audit notification failed:', err.message);
  }
};

const label = (r) => `${r.employeeName || 'Employee'}${r.employeeId ? ` (${r.employeeId})` : ''}`;
const amountText = (r) => `PKR ${Number(r.netSettlementAmount || 0).toLocaleString()}`;

/** GM HR approval (or an older AVP approval) hands the settlement to Audit. Caller saves nothing else. */
const sendToAudit = async (record, userId, comments = '') => {
  const from = record.workflowStatus;
  record.workflowStatus = 'Pending Audit';
  AUDIT_FIELDS.forEach((k) => { record[k] = undefined; });
  pushHistory(record, from, 'Pending Audit', userId, comments || 'Sent to Audit', 'HR');
  record.updatedBy = userId;
  await record.save();
  await notify({
    roles: ['auditor', 'audit_manager', 'super_admin'],
    actorId: userId,
    title: 'Final settlement waiting for audit',
    message: `Final settlement of ${label(record)} — ${amountText(record)} is waiting in Pre-Audit.`,
    record,
    actionUrl: '/audit/pre-audit'
  });
};

/** Initial approval (pre-audit staff) or final approval (Audit Director → CEO) */
const auditApprove = async (id, user, comments = '') => {
  if (!hasAuditAccess(user)) throw fail('Audit access required', 403);
  const record = await FinalSettlement.findById(id);
  if (!record) throw fail('Settlement not found', 404);
  const uid = user._id || user.id;

  if (record.workflowStatus === 'Pending Audit') {
    if (!canPerformInitialPreAuditActions(user)) {
      throw fail('Initial approval is done by pre-audit staff, not the Audit Director', 403);
    }
    record.preAuditInitialApprovedBy = uid;
    record.preAuditInitialApprovedAt = new Date();
    record.preAuditInitialComments = comments;
    pushHistory(record, 'Pending Audit', 'Pending Audit', uid, comments || 'Initial pre-audit approval recorded');
    record.updatedBy = uid;
    await record.save();
    return { record, message: 'Initial pre-audit approval recorded. Forward to Audit Director for final approval.' };
  }

  if (record.workflowStatus !== 'Forwarded to Audit Director') {
    throw fail(`Final settlement is ${record.workflowStatus}, not with Audit`);
  }
  if (!canActAsAuditDirector(user)) throw fail('Only the Audit Director can give final audit approval', 403);
  record.workflowStatus = 'Forwarded to CEO';
  record.auditApprovedBy = uid;
  record.auditApprovedAt = new Date();
  record.auditComments = comments;
  pushHistory(record, 'Forwarded to Audit Director', 'Forwarded to CEO', uid, comments || 'Audit Director approved — sent to CEO');
  record.updatedBy = uid;
  await record.save();
  return { record, message: 'Audit approved — sent to CEO for approval' };
};

const forwardToAuditDirector = async (id, user, comments = '') => {
  if (!canPerformInitialPreAuditActions(user)) {
    throw fail('Only General Audit / pre-audit staff can forward to Audit Director (not Audit Director).', 403);
  }
  const record = await FinalSettlement.findById(id);
  if (!record) throw fail('Settlement not found', 404);
  if (record.workflowStatus === 'Forwarded to Audit Director') throw fail('Document is already forwarded to Audit Director');
  if (record.workflowStatus !== 'Pending Audit') throw fail(`Final settlement is ${record.workflowStatus}, not Pending Audit`);
  if (!record.preAuditInitialApprovedAt) throw fail('Initial pre-audit approval is required before forwarding to Audit Director.');
  const uid = user._id || user.id;
  record.workflowStatus = 'Forwarded to Audit Director';
  record.auditForwardedBy = uid;
  record.auditForwardedAt = new Date();
  pushHistory(record, 'Pending Audit', 'Forwarded to Audit Director', uid, comments || 'Forwarded to Audit Director for approval');
  record.updatedBy = uid;
  await record.save();
  await notify({
    roles: ['audit_director', 'super_admin'],
    actorId: uid,
    title: 'Document forwarded to Audit Director',
    message: `Final settlement of ${label(record)} is waiting for your approval.`,
    record,
    actionUrl: '/audit/pre-audit'
  });
  return { record, message: 'Document forwarded to Audit Director successfully' };
};

/** Return from Audit → back to HR (Returned) with comments and observations */
const auditReturn = async (id, user, { comments = '', observations = [] } = {}) => {
  if (!hasAuditAccess(user)) throw fail('Audit access required', 403);
  const record = await FinalSettlement.findById(id);
  if (!record) throw fail('Settlement not found', 404);
  if (!AUDIT_QUEUE_STATUSES.includes(record.workflowStatus)) {
    throw fail(`Audit can only return a settlement that is with Audit (now ${record.workflowStatus})`);
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
  record.returnedBy = uid;
  record.returnedAt = new Date();
  record.returnComments = `Audit: ${text || obs.map((o) => o.observation).join('; ')}`;
  obs.forEach((o) => record.auditObservations.push({ ...o, addedBy: uid, addedAt: new Date() }));
  AUDIT_FIELDS.forEach((k) => { record[k] = undefined; });
  pushHistory(record, from, 'Returned', uid, record.returnComments);
  record.updatedBy = uid;
  await record.save();
  await notify({
    recipientIds: [record.forwardedBy, record.createdBy],
    actorId: uid,
    title: 'Final settlement returned by Audit',
    message: `${label(record)}: ${record.returnComments}`,
    record,
    actionUrl: '/hr/settlements',
    type: 'warning'
  });
  return { record, message: 'Returned to HR with audit comments' };
};

/** Pre-Audit status key for the audit queue tabs */
const preAuditStatusOf = (r) => {
  if (r.workflowStatus === 'Forwarded to Audit Director') return 'forwarded_to_director';
  if (r.auditApprovedAt && !['Pending Audit', 'Returned'].includes(r.workflowStatus)) return 'approved';
  if (r.workflowStatus === 'Returned' && AUDIT_QUEUE_STATUSES.includes(r.returnedFromStatus)) return 'returned_with_observations';
  return r.preAuditInitialApprovedAt ? 'under_review' : 'pending';
};

/** Rows for GET /api/pre-audit */
const listFinalSettlementsForPreAudit = async (search = '') => {
  const query = {
    $or: [
      { workflowStatus: { $in: AUDIT_QUEUE_STATUSES } },
      { auditApprovedAt: { $exists: true, $ne: null }, workflowStatus: { $nin: ['Pending Audit', 'Returned'] } },
      { workflowStatus: 'Returned', returnedFromStatus: { $in: AUDIT_QUEUE_STATUSES } }
    ]
  };
  if (search) {
    query.$and = [{ $or: [
      { employeeName: { $regex: search, $options: 'i' } },
      { employeeId: { $regex: search, $options: 'i' } },
      { department: { $regex: search, $options: 'i' } }
    ] }];
  }
  const ppl = 'firstName lastName email digitalSignature';
  const docs = await FinalSettlement.find(query)
    .populate('forwardedBy', ppl).populate('hodApprovedBy', ppl).populate('ceoApprovedBy', ppl)
    .populate('preAuditInitialApprovedBy', ppl).populate('auditApprovedBy', ppl).populate('createdBy', ppl)
    .populate('workflowHistory.changedBy', 'firstName lastName email employeeId digitalSignature approvalStamp')
    .populate('auditObservations.addedBy', 'firstName lastName email')
    .sort({ updatedAt: -1 })
    .limit(500)
    .lean();
  return docs.map((doc) => {
    const number = `FS-${String(doc._id).slice(-6).toUpperCase()}`;
    return {
      _id: doc._id,
      documentNumber: number,
      title: `Final Settlement: ${doc.employeeName}${doc.employeeId ? ` (${doc.employeeId})` : ''}`,
      description: [doc.designation, doc.department, doc.companyName].filter((x) => x && x !== 'Unknown').join(' · ') || 'Final settlement',
      sourceModule: 'hr',
      sourceDepartmentName: 'HR — Final Settlement',
      companyName: doc.companyName || '',
      company: doc.companyName || '',
      sourceDepartment: null,
      documentType: 'Final Settlement',
      documentDate: doc.hodApprovedAt || doc.updatedAt || doc.createdAt,
      amount: doc.netSettlementAmount || 0,
      referenceNumber: number,
      status: preAuditStatusOf(doc),
      workflowStatus: doc.workflowStatus,
      priority: 'high',
      isWorkflowDocument: false,
      isPurchaseOrder: false,
      isCashApproval: false,
      isFinalSettlement: true,
      originalDocument: doc,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
      createdBy: doc.createdBy,
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
  listFinalSettlementsForPreAudit
};
