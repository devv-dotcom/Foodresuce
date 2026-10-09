const pool = require('../config/database');

/**
 * Creates an in-system notification for a specific user or role broadcast
 */
async function sendNotification({ recipientUserId = null, targetRole = 'all', title, message, notificationType = null, donationId = null, connection = null }) {
  const executor = connection || pool;
  const dedupeKey = recipientUserId && notificationType && donationId
    ? `${notificationType}:${donationId}:${recipientUserId}`.slice(0, 190)
    : null;
  await executor.execute(
    `INSERT INTO notifications
       (created_by, recipient_user_id, target_role, title, message, is_read, notification_type, related_donation_id, dedupe_key)
     VALUES (NULL, ?, ?, ?, ?, FALSE, ?, ?, ?)
     ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`,
    [recipientUserId, targetRole, title, message, notificationType, donationId, dedupeKey]
  );
}

/**
 * Awards impact points and updates badge level for a user
 */
async function awardPoints(userId, pointsToAdd, connection = null) {
  try {
    const executor = connection || pool;
    await executor.execute(
      `UPDATE users
       SET impact_points = impact_points + ?
       WHERE id = ?`,
      [pointsToAdd, userId]
    );

    // Update badge tier based on total points
    const [rows] = await executor.execute(`SELECT impact_points FROM users WHERE id = ?`, [userId]);
    if (rows.length) {
      const pts = rows[0].impact_points;
      let badge = 'Bronze Hero';
      if (pts >= 2000) badge = 'Platinum Hero 👑';
      else if (pts >= 1000) badge = 'Gold Guardian 🥇';
      else if (pts >= 400) badge = 'Silver Saver 🥈';

      await executor.execute(`UPDATE users SET badge_level = ? WHERE id = ?`, [badge, userId]);
    }
  } catch (error) {
    console.error('[AWARD POINTS ERROR]', error.message);
  }
}

module.exports = {
  sendNotification,
  awardPoints
};
