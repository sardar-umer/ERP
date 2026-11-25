/**
 * approvalNotify.js
 * One place to announce approval-workflow events:
 *   - notifyApprovalAssigned: a document now waits on someone (bell + WhatsApp + internal chat)
 *   - notifyDocumentOutcome:  tell the initiator it was approved / returned / rejected (bell, with remarks)
 *
 * Every function is best-effort: it logs and swallows errors so a notification problem
 * can never fail the approval action that triggered it.
 */
const User = require('../models/User');
const { createAndEmitNotification } = require('../services/realtimeNotificationService');
const { notifyApprovers } = require('./approvalWhatsAppNotifier');
const { notifyChatApprovers } = require('./approvalChatNotifier');

const idOf = (v) => {
  if (!v) return '';
  if (typeof v === 'object') return String(v._id || v.id || '');
  return String(v);
};

const uniqueIds = (list = []) => [...new Set((Array.isArray(list) ? list : [list]).map(idOf).filter(Boolean))];

const personName = (user) => {
  if (!user || typeof user !== 'object') return '';
  return [user.firstName, user.lastName].filter(Boolean).join(' ').trim() || user.email || '';
};

const docLabel = (docType, docNumber) => [docType, docNumber].filter(Boolean).join(' ');

/** Active users holding any of the given roles (legacy `role` field). */
async function getActiveUserIdsByRoles(roles = []) {
  if (!roles.length) return [];
  const users = await User.find({ role: { $in: roles }, isActive: true }).select('_id').lean();
  return users.map((u) => String(u._id));
}

/**
 * A document is now waiting on these people.
 * @param {object} p
 * @param {Array} p.recipientIds  users who must act (ids or user objects)
 * @param {object} p.actor        req.user of whoever moved it (excluded from recipients)
 * @param {string} p.docType      e.g. 'New-Hiring Approval'
 * @param {string} p.docNumber    e.g. 'NE-0042'
 * @param {string} p.url          client route to open
 * @param {string} [p.stageLabel] e.g. 'Chairman Steering Committee'
 * @param {string} [p.module]     Notification metadata.module (hr, procurement, finance, …)
 * @param {boolean} [p.external=true] also send WhatsApp + internal chat (allow-listed users only)
 */
async function notifyApprovalAssigned({
  recipientIds = [],
  actor = null,
  docType = 'Document',
  docNumber = '',
  url = '',
  stageLabel = '',
  module = 'other',
  entityId = null,
  entityType = '',
  title,
  message,
  external = true
} = {}) {
  try {
    const actorId = idOf(actor);
    const ids = uniqueIds(recipientIds).filter((id) => id !== actorId);
    if (!ids.length) return;

    const label = docLabel(docType, docNumber);
    const fromName = personName(actor);
    await createAndEmitNotification({
      recipientIds: ids,
      title: title || `${label} needs your approval`,
      message: message || [
        fromName ? `Sent by ${fromName}.` : '',
        stageLabel ? `Waiting at: ${stageLabel}.` : '',
        'Please review it in your approval queue.'
      ].filter(Boolean).join(' '),
      priority: 'high',
      type: 'info',
      category: 'approval',
      actionUrl: url,
      createdBy: actorId || null,
      excludeUserId: actorId || null,
      metadata: { module, entityId: entityId || undefined, entityType }
    });

    if (external) {
      const ctx = { docType, docNumber, url, fromUser: actor };
      notifyApprovers(ids, ctx).catch(() => {});
      notifyChatApprovers(ids, ctx).catch(() => {});
    }
  } catch (err) {
    console.warn('[approvalNotify] assigned notification failed:', err.message);
  }
}

const OUTCOME_TEXT = {
  approved: { verb: 'approved', priority: 'medium', type: 'success' },
  final_approved: { verb: 'fully approved', priority: 'high', type: 'success' },
  returned: { verb: 'returned to you for correction', priority: 'high', type: 'warning' },
  rejected: { verb: 'rejected', priority: 'high', type: 'error' },
  cancelled: { verb: 'cancelled', priority: 'medium', type: 'warning' },
  issued: { verb: 'issued', priority: 'medium', type: 'success' }
};

/**
 * Tell the initiator (and anyone else interested) what happened to their document.
 * @param {string} p.outcome  approved | final_approved | returned | rejected | cancelled | issued
 * @param {string} [p.remarks] approver's comments, shown in the message
 * @param {string} [p.stageLabel] who acted, e.g. 'CEO Secretariat'
 */
async function notifyDocumentOutcome({
  recipientIds = [],
  actor = null,
  outcome = 'approved',
  docType = 'Document',
  docNumber = '',
  url = '',
  stageLabel = '',
  remarks = '',
  module = 'other',
  entityId = null,
  entityType = '',
  title,
  message
} = {}) {
  try {
    const actorId = idOf(actor);
    const ids = uniqueIds(recipientIds).filter((id) => id !== actorId);
    if (!ids.length) return;

    const o = OUTCOME_TEXT[outcome] || OUTCOME_TEXT.approved;
    const label = docLabel(docType, docNumber);
    const by = stageLabel || personName(actor);
    let cleanRemarks = String(remarks || '').trim().slice(0, 300);
    if (cleanRemarks && !/[.!?]$/.test(cleanRemarks)) cleanRemarks += '.';

    await createAndEmitNotification({
      recipientIds: ids,
      title: title || `${label} ${o.verb}`,
      message: message || [
        by ? `By ${by}.` : '',
        cleanRemarks ? `Remarks: ${cleanRemarks}` : '',
        outcome === 'returned' ? 'Please make the changes and resubmit.' : ''
      ].filter(Boolean).join(' ') || `${label} was ${o.verb}.`,
      priority: o.priority,
      type: o.type,
      category: 'approval',
      actionUrl: url,
      createdBy: actorId || null,
      excludeUserId: actorId || null,
      metadata: { module, entityId: entityId || undefined, entityType }
    });
  } catch (err) {
    console.warn('[approvalNotify] outcome notification failed:', err.message);
  }
}

module.exports = {
  notifyApprovalAssigned,
  notifyDocumentOutcome,
  getActiveUserIdsByRoles
};
