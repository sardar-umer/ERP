const path = require('path');
const fsSync = require('fs');

const repoRoot = path.join(__dirname, '..', '..');
const envPath = path.join(repoRoot, '.env');
const localPath = path.join(repoRoot, '.env.local');
if (fsSync.existsSync(envPath)) require('dotenv').config({ path: envPath });
if (fsSync.existsSync(localPath)) require('dotenv').config({ path: localPath, override: true });

const { connectDB, disconnectDB } = require('../config/database');
const User = require('../models/User');

async function fixNamesAndCreateBot() {
  try {
    await connectDB();
    
    // 2. Create a dedicated bot user "bot@tovus.net" named "TOVUS ERP"
    let botUser = await User.findOne({ email: 'bot@tovus.net' });
    if (!botUser) {
      botUser = new User({
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
      await botUser.save();
      console.log('Created new bot user: TOVUS ERP');
    } else {
      console.log('Bot user already exists:', botUser.firstName, botUser.lastName);
    }
    
  } catch (err) {
    console.error(err);
  } finally {
    await disconnectDB();
    process.exit(0);
  }
}
fixNamesAndCreateBot();
