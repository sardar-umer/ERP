/**
 * Lock down the "TOVUS ERP" chat bot account (bot@tovus.net).
 *
 * The bot used to be created with role "admin" and a password written in the source code,
 * so anyone who had seen the code could sign in as an admin. This script:
 *   - sets role to "employee" and clears any RBAC roles (it only sends chat messages)
 *   - replaces the password with a long random one that is never printed or stored
 *
 * The bot keeps working: approval chat messages are written server-side, never by logging in.
 *
 * Usage (dry run first, then apply):
 *   node server/scripts/secure-bot-user.js
 *   node server/scripts/secure-bot-user.js --apply
 *
 * For production, open the DB tunnel first and point MONGODB_URI at it (see DEPLOYMENT notes).
 */
const path = require('path');
const fsSync = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const repoRoot = path.join(__dirname, '..', '..');
const envPath = path.join(repoRoot, '.env');
const localPath = path.join(repoRoot, '.env.local');
if (fsSync.existsSync(envPath)) require('dotenv').config({ path: envPath });
if (fsSync.existsSync(localPath)) require('dotenv').config({ path: localPath, override: true });

const { connectDB, disconnectDB } = require('../config/database');
const User = require('../models/User');

const BOT_EMAIL = 'bot@tovus.net';
const APPLY = process.argv.includes('--apply');

(async () => {
  let code = 0;
  try {
    await connectDB();
    const bot = await User.findOne({ email: BOT_EMAIL });
    if (!bot) {
      console.log(`No ${BOT_EMAIL} user found — nothing to do (it will be created safely on first use).`);
      return;
    }

    const extraRoles = (Array.isArray(bot.roles) ? bot.roles.length : 0) + (bot.roleRef ? 1 : 0);
    console.log(`Found ${BOT_EMAIL} (${bot._id})`);
    console.log(`  role now:        ${bot.role}`);
    console.log(`  RBAC roles now:  ${extraRoles}`);
    console.log(`  will become:     role=employee, RBAC roles cleared, new random password`);

    if (!APPLY) {
      console.log('\nDry run only. Re-run with --apply to make the change.');
      return;
    }

    // Direct update (skips unrelated profile validation); hash exactly like the User pre-save hook
    const hashed = await bcrypt.hash(crypto.randomBytes(32).toString('base64url'), await bcrypt.genSalt(12));
    await User.updateOne(
      { _id: bot._id },
      {
        $set: { role: 'employee', roles: [], password: hashed, position: bot.position || 'System Bot' },
        $unset: { roleRef: '' }
      }
    );
    console.log('\n✅ Bot account secured: role=employee, password rotated (not shown).');
  } catch (err) {
    console.error('❌ Failed:', err.message);
    code = 1;
  } finally {
    await disconnectDB().catch(() => {});
    process.exit(code);
  }
})();
