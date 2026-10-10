'use strict';

const bcrypt = require('bcrypt');
const pool = require('../config/database');
const { getAdminEmail } = require('../config/adminConfig');

async function seedAdminAccount() {
  const adminEmail = getAdminEmail();
  const adminPass = String(process.env.ADMIN_PASSWORD || '');
  if (!adminPass.trim()) {
    console.warn('[Admin Seed] Skipped: ADMIN_PASSWORD must be configured to provision the administrator.');
    return false;
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [existingUsers] = await connection.execute(
      'SELECT id, role, password FROM users WHERE LOWER(email) = LOWER(?) LIMIT 1 FOR UPDATE',
      [adminEmail]
    );

    let userId;
    const hashedPassword = await bcrypt.hash(adminPass, 12);
    const profile = {
      mobile: process.env.ADMIN_MOBILE || '0000000000',
      address: process.env.ADMIN_ADDRESS || 'Food Rescue System Office',
      city: process.env.ADMIN_CITY || 'System',
      state: process.env.ADMIN_STATE || 'System',
      pincode: process.env.ADMIN_PINCODE || '000000'
    };

    if (existingUsers.length) {
      const existing = existingUsers[0];
      if (existing.role !== 'admin') {
        const conflict = new Error('ADMIN_EMAIL_ROLE_CONFLICT');
        conflict.code = 'ADMIN_EMAIL_ROLE_CONFLICT';
        throw conflict;
      }
      userId = existing.id;
      const passwordMatches = await bcrypt.compare(adminPass, existing.password);
      const passwordUpdate = passwordMatches
        ? ''
        : 'password = ?, token_version = token_version + 1,';
      const values = passwordMatches
        ? [profile.mobile, profile.address, profile.city, profile.state, profile.pincode, userId]
        : [hashedPassword, profile.mobile, profile.address, profile.city, profile.state, profile.pincode, userId];
      await connection.execute(
        `UPDATE users SET ${passwordUpdate}
          mobile = COALESCE(NULLIF(mobile, ''), ?),
          address = COALESCE(NULLIF(address, ''), ?),
          city = COALESCE(NULLIF(city, ''), ?),
          state = COALESCE(NULLIF(state, ''), ?),
          pincode = COALESCE(NULLIF(pincode, ''), ?)
         WHERE id = ? AND role = 'admin'`,
        values
      );
    } else {
      const [insertUser] = await connection.execute(
        `INSERT INTO users (full_name, email, mobile, password, role, address, city, state, pincode, is_verified, created_at)
         VALUES (?, ?, ?, ?, 'admin', ?, ?, ?, ?, 1, CURRENT_TIMESTAMP)`,
        ['System Administrator', adminEmail, profile.mobile, hashedPassword,
          profile.address, profile.city, profile.state, profile.pincode]
      );
      userId = insertUser.insertId;
    }

    const [existingAdmins] = await connection.execute(
      'SELECT id FROM admins WHERE user_id = ? LIMIT 1 FOR UPDATE',
      [userId]
    );
    if (!existingAdmins.length) {
      await connection.execute(
        "INSERT INTO admins (user_id, account_status, created_at) VALUES (?, 'active', CURRENT_TIMESTAMP)",
        [userId]
      );
    }

    await connection.commit();
    return true;
  } catch (error) {
    try { await connection.rollback(); } catch (_) { /* Preserve the original error. */ }
    console.error('[Admin Seed] Provisioning failed.', error.code || 'ADMIN_SEED_FAILED');
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = { seedAdminAccount };
