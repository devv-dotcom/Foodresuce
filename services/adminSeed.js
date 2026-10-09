const bcrypt = require('bcrypt');
const pool = require('../config/database');
const { getAdminEmail } = require('../config/adminConfig');

async function seedAdminAccount() {
  try {
    const adminEmail = getAdminEmail();
    const adminPass = String(process.env.ADMIN_PASSWORD || '');
    if (!adminPass.trim()) {
      console.warn('[Admin Seed] Skipped: ADMIN_PASSWORD must be configured to provision the administrator.');
      return;
    }
    const adminName = 'System Administrator';
    // The users table requires a complete contact record even for system
    // accounts. Deployments may override these default seed values.
    const adminProfile = {
      mobile: process.env.ADMIN_MOBILE || '0000000000',
      address: process.env.ADMIN_ADDRESS || 'Food Rescue System Office',
      city: process.env.ADMIN_CITY || 'System',
      state: process.env.ADMIN_STATE || 'System',
      pincode: process.env.ADMIN_PINCODE || '000000'
    };

    // 0. Ensure login_otp and location columns exist in users table
    try {
      await pool.execute("ALTER TABLE users ADD COLUMN login_otp VARCHAR(255) NULL, ADD COLUMN login_otp_expires_at DATETIME NULL");
    } catch (_) { /* columns already exist */ }

    try {
      await pool.execute("ALTER TABLE users ADD COLUMN latitude DECIMAL(10,7) NULL, ADD COLUMN longitude DECIMAL(10,7) NULL");
    } catch (_) { /* columns already exist */ }

    // 1. Check if user with adminEmail exists
    const [existingUsers] = await pool.execute('SELECT id, role FROM users WHERE LOWER(email) = LOWER(?)', [adminEmail]);
    
    let userId = null;
    if (existingUsers.length === 0) {
      const hashedPassword = await bcrypt.hash(adminPass, 12);
      const [insertUser] = await pool.execute(
        `INSERT INTO users (full_name, email, mobile, password, role, address, city, state, pincode, is_verified, created_at)
         VALUES (?, ?, ?, ?, 'admin', ?, ?, ?, ?, 1, CURRENT_TIMESTAMP)`,
        [adminName, adminEmail, adminProfile.mobile, hashedPassword, adminProfile.address,
          adminProfile.city, adminProfile.state, adminProfile.pincode]
      );
      userId = insertUser.insertId;
      console.log(`[Admin Seed] Created default admin user: ${adminEmail}`);
    } else {
      userId = existingUsers[0].id;
      const hashedPassword = await bcrypt.hash(adminPass, 12);
      await pool.execute(
        `UPDATE users
         SET role = 'admin',
             email = ?,
             password = ?,
             mobile = COALESCE(NULLIF(mobile, ''), ?),
             address = COALESCE(NULLIF(address, ''), ?),
             city = COALESCE(NULLIF(city, ''), ?),
             state = COALESCE(NULLIF(state, ''), ?),
             pincode = COALESCE(NULLIF(pincode, ''), ?)
         WHERE id = ?`,
        [adminEmail, hashedPassword, adminProfile.mobile, adminProfile.address, adminProfile.city,
          adminProfile.state, adminProfile.pincode, userId]
      );
    }

    // 2. Ensure row exists in admins table
    const [existingAdmins] = await pool.execute('SELECT id FROM admins WHERE user_id = ?', [userId]);
    if (existingAdmins.length === 0) {
      await pool.execute(
        `INSERT INTO admins (user_id, account_status, created_at)
         VALUES (?, 'active', CURRENT_TIMESTAMP)`,
        [userId]
      );
      console.log(`[Admin Seed] Provisioned admin profile for user ID ${userId}`);
    } else {
      await pool.execute("UPDATE admins SET account_status = 'active' WHERE user_id = ?", [userId]);
    }

  } catch (err) {
    console.error('[Admin Seed] Error seeding admin account:', err.code || 'UNKNOWN_ERROR', err.message || err);
  }
}

module.exports = { seedAdminAccount };
