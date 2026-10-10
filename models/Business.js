const pool = require('../config/database');

const Business = {
  async findDashboardUser(userId) {
    const [rows] = await pool.execute(
      `SELECT id, full_name, email, mobile, role, business_name, address, city, state, pincode, latitude, longitude,
              profile_image, is_verified, created_at
       FROM users WHERE id = ? LIMIT 1`,
      [userId]
    );
    return rows[0] || null;
  },

  async updateUser(connection, userId, data) {
    await connection.execute(
      `UPDATE users SET full_name = ?, email = ?, mobile = ?, business_name = ?, address = ?, city = ?, state = ?, pincode = ?, latitude = COALESCE(?, latitude), longitude = COALESCE(?, longitude)
       WHERE id = ?`,
      [data.fullName, data.email, data.mobile, data.businessName, data.address, data.city, data.state, data.pincode, data.latitude ?? null, data.longitude ?? null, userId]
    );
  },

  async emailInUse(connection, email, userId) {
    const [rows] = await connection.execute('SELECT id FROM users WHERE email = ? AND id != ? LIMIT 1', [email, userId]);
    return Boolean(rows[0]);
  },

  async changePassword(userId, passwordHash) {
    await pool.execute('UPDATE users SET password = ?, token_version = token_version + 1 WHERE id = ?', [passwordHash, userId]);
  }
};

module.exports = Business;
