const pool = require('../config/database');

module.exports = {
  async list(limit = 20, offset = 0) {
    const [rows] = await pool.execute(`SELECT n.*, u.full_name AS creator_name FROM notifications n JOIN admins a ON a.id = n.created_by JOIN users u ON u.id = a.user_id ORDER BY n.created_at DESC LIMIT ? OFFSET ?`, [limit, offset]);
    return rows;
  },
  async listForUser(userId, role = 'all') {
    const [rows] = await pool.execute(
      `SELECT n.* FROM notifications n
       WHERE n.recipient_user_id = ? OR (n.recipient_user_id IS NULL AND n.target_role IN (?, 'all'))
       ORDER BY n.created_at DESC LIMIT 30`,
      [userId, role]
    );
    return rows;
  },
  async create(adminId, data) {
    const [result] = await pool.execute('INSERT INTO notifications (created_by, recipient_user_id, target_role, title, message) VALUES (?, ?, ?, ?, ?)', [adminId, data.recipientUserId || null, data.targetRole || 'all', data.title, data.message]);
    return result.insertId;
  },
  async remove(id) { const [result] = await pool.execute('DELETE FROM notifications WHERE id = ?', [id]); return result.affectedRows; },
  async markRead(id, userId, role) {
    const [result] = await pool.execute(
      "UPDATE notifications SET is_read = TRUE WHERE id = ? AND (recipient_user_id = ? OR (recipient_user_id IS NULL AND target_role IN (?, 'all')))",
      [id, userId, role]
    );
    return result.affectedRows;
  },
  async markAllRead(userId, role) {
    const [result] = await pool.execute(
      "UPDATE notifications SET is_read = TRUE WHERE recipient_user_id = ? OR (recipient_user_id IS NULL AND target_role IN (?, 'all'))",
      [userId, role]
    );
    return result.affectedRows;
  }
};
