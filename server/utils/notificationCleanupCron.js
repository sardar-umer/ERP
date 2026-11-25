/**
 * Nightly cron: delete bell notifications that were READ (or archived) long ago,
 * so the notifications collection doesn't grow forever.
 *
 * - Unread notifications are never touched (they may still be pending actions).
 * - Retention defaults to 90 days after the notification was read;
 *   override with NOTIFICATION_READ_RETENTION_DAYS in .env (minimum 7).
 * - Runs every day at 02:30 AM Asia/Karachi, plus once ~60s after startup.
 */
const cron = require('node-cron');

const DEFAULT_RETENTION_DAYS = 90;

const retentionDays = () => {
  const n = parseInt(process.env.NOTIFICATION_READ_RETENTION_DAYS, 10);
  return Number.isFinite(n) && n >= 7 ? n : DEFAULT_RETENTION_DAYS;
};

async function runNotificationCleanup({ days = retentionDays(), now = new Date() } = {}) {
  try {
    const Notification = require('../models/hr/Notification');
    const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

    const result = await Notification.deleteMany({
      isRead: true,
      $or: [
        { readAt: { $lt: cutoff } },
        // Older rows marked read without a readAt: fall back to when they were created
        { readAt: { $exists: false }, createdAt: { $lt: cutoff } },
        { readAt: null, createdAt: { $lt: cutoff } }
      ]
    });

    if (result.deletedCount) {
      console.log(`[NotificationCleanup] deleted ${result.deletedCount} notification(s) read more than ${days} days ago`);
    }
    return result.deletedCount || 0;
  } catch (err) {
    console.error('[NotificationCleanup] cleanup failed:', err.message);
    return 0;
  }
}

function startNotificationCleanupCron() {
  cron.schedule('30 2 * * *', () => runNotificationCleanup(), { timezone: 'Asia/Karachi' });
  console.log(`✅ Notification Cleanup Cron started (02:30 AM PKT daily, read > ${retentionDays()} days)`);
  setTimeout(() => {
    runNotificationCleanup().catch(() => {});
  }, 60_000);
}

module.exports = {
  startNotificationCleanupCron,
  runNotificationCleanup
};
