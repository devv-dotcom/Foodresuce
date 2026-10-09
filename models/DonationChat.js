const pool = require('../config/database');

const participantQuery = `
  SELECT d.id AS donation_id, d.business_user_id AS donor_user_id, n.user_id AS ngo_user_id,
         d.food_name, COALESCE(n.ngo_name, ngo_user.full_name) AS ngo_name,
         COALESCE(donor.business_name, donor.full_name) AS donor_name
  FROM donations d
  JOIN accepted_donations ad ON ad.donation_id = d.id
  JOIN ngos n ON n.id = ad.ngo_id
  JOIN users donor ON donor.id = d.business_user_id
  JOIN users ngo_user ON ngo_user.id = n.user_id
  WHERE d.id = ? AND d.deleted_at IS NULL
  LIMIT 1`;

module.exports = {
  async listForUser(userId) {
    const [rows] = await pool.execute(
      `SELECT c.donation_id, d.food_name,
              CASE WHEN c.donor_user_id = ?
                THEN COALESCE(n.ngo_name, ngo_user.full_name)
                ELSE COALESCE(donor.business_name, donor.full_name)
              END AS other_party_name,
              (SELECT m.body FROM donation_messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS last_message,
              (SELECT m.created_at FROM donation_messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS last_message_at,
              (SELECT COUNT(*) FROM donation_messages m WHERE m.conversation_id = c.id AND m.recipient_user_id = ? AND m.read_at IS NULL) AS unread_count
       FROM donation_conversations c
       JOIN donations d ON d.id = c.donation_id AND d.deleted_at IS NULL
       JOIN users donor ON donor.id = c.donor_user_id
       JOIN users ngo_user ON ngo_user.id = c.ngo_user_id
       LEFT JOIN ngos n ON n.user_id = c.ngo_user_id
       WHERE c.donor_user_id = ? OR c.ngo_user_id = ?
       ORDER BY c.updated_at DESC, c.id DESC
       LIMIT 100`,
      [userId, userId, userId, userId]
    );
    return rows;
  },

  async participant(donationId, userId, connection = pool) {
    const [rows] = await connection.execute(participantQuery, [donationId]);
    const chat = rows[0] || null;
    if (!chat || (Number(chat.donor_user_id) !== Number(userId) && Number(chat.ngo_user_id) !== Number(userId))) return null;
    return chat;
  },

  async getOrCreate(connection, participant) {
    await connection.execute(
      `INSERT INTO donation_conversations (donation_id, donor_user_id, ngo_user_id)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`,
      [participant.donation_id, participant.donor_user_id, participant.ngo_user_id]
    );
    const [rows] = await connection.execute('SELECT id, donation_id, donor_user_id, ngo_user_id, created_at, updated_at FROM donation_conversations WHERE donation_id = ? LIMIT 1', [participant.donation_id]);
    return rows[0];
  },

  async messages(conversationId, viewerId) {
    await pool.execute(
      'UPDATE donation_messages SET read_at = CURRENT_TIMESTAMP WHERE conversation_id = ? AND recipient_user_id = ? AND read_at IS NULL',
      [conversationId, viewerId]
    );
    const [rows] = await pool.execute(
      `SELECT m.id, m.sender_user_id, m.recipient_user_id, m.body, m.created_at, m.read_at,
              u.full_name AS sender_name
       FROM donation_messages m
       JOIN users u ON u.id = m.sender_user_id
       WHERE m.conversation_id = ?
       ORDER BY m.created_at ASC, m.id ASC`,
      [conversationId]
    );
    return rows.map(row => ({ ...row, is_read: row.recipient_user_id === viewerId ? Boolean(row.read_at) : true }));
  },

  async unreadCount(conversationId, userId) {
    const [rows] = await pool.execute(
      'SELECT COUNT(*) AS count FROM donation_messages WHERE conversation_id = ? AND recipient_user_id = ? AND read_at IS NULL',
      [conversationId, userId]
    );
    return Number(rows[0]?.count || 0);
  },

  async send(connection, conversationId, senderUserId, recipientUserId, body) {
    const [result] = await connection.execute(
      'INSERT INTO donation_messages (conversation_id, sender_user_id, recipient_user_id, body) VALUES (?, ?, ?, ?)',
      [conversationId, senderUserId, recipientUserId, body]
    );
    await connection.execute('UPDATE donation_conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?', [conversationId]);
    return result.insertId;
  }
};
