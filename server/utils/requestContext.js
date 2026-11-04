/**
 * Per-request context (who is acting) available anywhere down the call chain,
 * e.g. in Mongoose hooks that record the Employee change log.
 */
const { AsyncLocalStorage } = require('async_hooks');

const storage = new AsyncLocalStorage();

/** Run `fn` with the acting user stored for everything it calls. */
const runWithUser = (user, fn) => storage.run({ userId: user?._id || user?.id || null }, fn);

/** Acting user id of the current request, or null (scripts, cron jobs). */
const currentUserId = () => storage.getStore()?.userId || null;

module.exports = { runWithUser, currentUserId };
