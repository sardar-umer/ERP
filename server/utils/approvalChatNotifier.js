/**
 * approvalChatNotifier.js
 * Utility to send internal chat notifications when a document is assigned.
 * Recipients must be: (1) the assigned approver, AND (2) on the dynamic allow-list.
 */
const User = require('../models/User');
const ChatConversation = require('../models/chat/ChatConversation');
const ChatMessage = require('../models/chat/ChatMessage');
const realtimeNotificationGateway = require('../services/realtimeNotificationGateway');
const { createAndEmitNotification } = require('../services/realtimeNotificationService');
const {
  filterUserIdsByApprovalNotifyAllowList,
  resolveInitiatorName
} = require('./approvalMobileNotifyRecipients');

// Simple serialize function for emitting new message
function serializeSystemMessage(doc, viewerId) {
  const v = String(viewerId);
  return {
    id: doc._id || doc.id,
    conversation: String(doc.conversation),
    sender: String(doc.sender),
    body: doc.body,
    isDeletedForEveryone: false,
    clientMessageId: doc.clientMessageId || '',
    replyTo: null,
    attachments: [],
    editedAt: null,
    deletedAt: null,
    deliveredAt: doc.deliveredAt || null,
    reactions: [],
    starredBy: [],
    isStarred: false,
    mentions: [],
    linkPreviews: [],
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt
  };
}

async function buildApprovalChatMessage(context = {}) {
  if (context.message) return context.message;

  const docType = context.docType || 'Document';
  const docNumber = context.docNumber || '';
  const docUrl = context.url
    ? `\n🔗 *Link:* ${process.env.CLIENT_URL || 'https://tovus.net'}${context.url}`
    : '';
  const fromName = await resolveInitiatorName(
    context.fromUser || context.fromName || context.initiator,
    User
  );
  const fromLine = fromName ? `\n👤 *From:* ${fromName}` : '';

  return (
    `🔔 *Approval Request*\n\n` +
    `📄 *Document:* ${docType}${docNumber ? ` (${docNumber})` : ''}` +
    `${fromLine}${docUrl}\n\n` +
    `You have been assigned to review this document. Please check your approval queue.`
  );
}

/**
 * Notify assigned approvers via Internal Chat (filtered by allow-list).
 * @param {string|string[]|object[]} userIds - Assigned approver user ID(s)
 * @param {{ docType?: string, docNumber?: string, message?: string, url?: string, fromUser?: object|string, fromName?: string }} context
 */
async function notifyChatApprovers(userIds, context = {}) {
  try {
    const rawIds = Array.isArray(userIds) ? userIds : [userIds];
    const extractedIds = rawIds
      .map((item) => (item && typeof item === 'object' ? String(item._id || item.id) : String(item)))
      .filter(Boolean);

    // Only assigned approvers who are on the dynamic mobile-notify allow-list
    const ids = await filterUserIdsByApprovalNotifyAllowList(extractedIds, User);
    if (!ids.length) {
      console.log('[ApprovalChat] No allow-listed assignees to notify.');
      return;
    }

    // Find the dedicated bot user (System Sender)
    let systemUser = await User.findOne({ email: 'bot@tovus.net' }).select('_id firstName lastName').lean();

    // Auto-create bot user if it doesn't exist (useful for clean production deployment)
    if (!systemUser) {
      const newBot = new User({
        email: 'bot@tovus.net',
        firstName: 'TOVUS',
        lastName: 'ERP',
        role: 'employee', // send-only system account — no admin rights
        isActive: true,
        // Nobody logs in as the bot: random throwaway password, never stored in code
        password: require('crypto').randomBytes(32).toString('base64url'),
        employeeId: 'BOT-001',
        position: 'System Bot',
        department: 'System'
      });
      await newBot.save();
      systemUser = { _id: newBot._id, firstName: newBot.firstName, lastName: newBot.lastName };
      console.log('[ApprovalChat] Automatically created TOVUS ERP bot user.');
    }

    const systemUserId = String(systemUser._id);
    const messageBody = await buildApprovalChatMessage(context);
    const snippet = messageBody.slice(0, 240);

    for (const userId of ids) {
      const targetId = String(userId);

      const participants = [systemUserId, targetId].sort();
      const pairKey = `${participants[0]}::${participants[1]}`;

      // 1. Find or create a direct conversation
      let conv = await ChatConversation.findOne({ pairKey, kind: 'direct' });

      if (!conv) {
        conv = await ChatConversation.create({
          pairKey,
          kind: 'direct',
          participants: [systemUserId, targetId],
          createdBy: systemUserId,
          admins: [systemUserId]
        });
      }

      // 2. Create the chat message
      const msgDoc = await ChatMessage.create({
        conversation: conv._id,
        sender: systemUserId,
        body: messageBody,
        deliveredAt: new Date()
      });

      // 3. Update conversation last message info
      conv.lastMessageAt = new Date();
      conv.lastMessageSnippet = snippet;
      conv.lastMessageSender = systemUserId;
      await conv.save();

      // 4. Emit socket events to the target user
      const serializedForTarget = serializeSystemMessage(msgDoc.toObject(), targetId);
      realtimeNotificationGateway.emitToUser(targetId, 'chat:message', {
        conversationId: String(conv._id),
        message: serializedForTarget
      });
      realtimeNotificationGateway.emitToUser(targetId, 'chat:conversation:updated', {
        conversationId: String(conv._id)
      });

      // TRIGGER PUSH NOTIFICATION FOR MOBILE APP
      try {
        const { sendPushNotification } = require('../services/pushNotificationService');
        await sendPushNotification([targetId], {
          title: 'TOVUS ERP',
          body: snippet,
          data: {
            type: 'chat_message',
            conversationId: String(conv._id),
            messageId: String(msgDoc._id),
            senderId: systemUserId
          }
        });
      } catch (e) {
        console.warn('[ApprovalChat] Push notification dispatch error:', e.message || e);
      }

      // If they are offline, also send the standard realtime notification for the web tray
      if (!realtimeNotificationGateway.isUserOnline(targetId)) {
        try {
          await createAndEmitNotification({
            recipientIds: [targetId],
            title: 'New chat message',
            message: `TOVUS ERP: ${snippet}`,
            type: 'chat_message',
            category: 'other',
            priority: 'low',
            actionUrl: `/chat/${conv._id}`,
            metadata: {
              module: 'other',
              entityId: conv._id,
              entityType: 'ChatConversation',
              additionalData: { conversationId: String(conv._id) }
            },
            createdBy: systemUserId
          });
        } catch (e) {
          console.warn('[ApprovalChat] Standard notification error:', e.message || e);
        }
      }

      if (targetId !== systemUserId) {
        const serializedForSystem = serializeSystemMessage(msgDoc.toObject(), systemUserId);
        realtimeNotificationGateway.emitToUser(systemUserId, 'chat:message', {
          conversationId: String(conv._id),
          message: serializedForSystem
        });
        realtimeNotificationGateway.emitToUser(systemUserId, 'chat:conversation:updated', {
          conversationId: String(conv._id)
        });
      }
    }
  } catch (err) {
    console.error('[ApprovalChat] Error in notifyChatApprovers:', err.message);
  }
}

module.exports = { notifyChatApprovers, buildApprovalChatMessage };
