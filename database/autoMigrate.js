const pool = require('../config/database');

async function runAutoMigration() {
  try {
    const connection = await pool.getConnection();
    try {
      const dbName = process.env.TIDB_DATABASE || process.env.DB_NAME || 'foodbridge';

      const helperCheckColumn = async (table, column) => {
        const [rows] = await connection.query(
          `SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
          [dbName, table, column]
        );
        return rows[0].cnt > 0;
      };
      const ensureColumn = async (table, column, definition) => {
        if (!(await helperCheckColumn(table, column))) {
          await connection.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
          console.log(`[MIGRATION] Added ${table}.${column}`);
        }
      };

      // 1. Users table additions
      if (!(await helperCheckColumn('users', 'impact_points'))) {
        await connection.query(`ALTER TABLE users ADD COLUMN impact_points INT UNSIGNED NOT NULL DEFAULT 0 AFTER is_verified`);
        console.log('[MIGRATION] Added users.impact_points');
      }
      if (!(await helperCheckColumn('users', 'badge_level'))) {
        await connection.query(`ALTER TABLE users ADD COLUMN badge_level VARCHAR(50) NOT NULL DEFAULT 'Bronze Hero' AFTER impact_points`);
        console.log('[MIGRATION] Added users.badge_level');
      }
      if (!(await helperCheckColumn('users', 'latitude'))) {
        await connection.query(`ALTER TABLE users ADD COLUMN latitude DECIMAL(10,7) NULL AFTER pincode, ADD COLUMN longitude DECIMAL(10,7) NULL AFTER latitude`);
        console.log('[MIGRATION] Added users.latitude/longitude');
      }

      // 2. Donations table additions
      if (!(await helperCheckColumn('donations', 'is_emergency'))) {
        await connection.query(`ALTER TABLE donations ADD COLUMN is_emergency BOOLEAN NOT NULL DEFAULT FALSE AFTER status`);
        console.log('[MIGRATION] Added donations.is_emergency');
      }
      // Additive donation fields retain existing rows and capture pickup and
      // donor-reported handling details for newly created/edited listings.
      await ensureColumn('donations', 'pickup_city', 'VARCHAR(100) NULL');
      await ensureColumn('donations', 'pickup_pincode', 'VARCHAR(12) NULL');
      await ensureColumn('donations', 'storage_condition', "VARCHAR(20) NOT NULL DEFAULT 'ambient'");
      await ensureColumn('donations', 'safety_hygiene_confirmed', 'BOOLEAN NOT NULL DEFAULT FALSE');
      await ensureColumn('donations', 'safety_storage_confirmed', 'BOOLEAN NOT NULL DEFAULT FALSE');
      await ensureColumn('donations', 'safety_deadline_confirmed', 'BOOLEAN NOT NULL DEFAULT FALSE');
      await ensureColumn('donations', 'safety_accuracy_confirmed', 'BOOLEAN NOT NULL DEFAULT FALSE');

      // Handoff codes are retained for the assigned partner to share with the
      // donor and recipient. Verification still stores only their hashes.
      const [assignmentTableRows] = await connection.query(
        'SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?',
        [dbName, 'assignments']
      );
      if (assignmentTableRows[0].cnt > 0) {
        await ensureColumn('assignments', 'pickup_code', 'VARCHAR(8) NULL');
        await ensureColumn('assignments', 'delivery_code', 'VARCHAR(8) NULL');
      }

      // 3. Pickup Requests additions for live tracking
      if (!(await helperCheckColumn('pickup_requests', 'current_latitude'))) {
        await connection.query(`ALTER TABLE pickup_requests ADD COLUMN current_latitude DECIMAL(10,7) NULL AFTER delivery_notes, ADD COLUMN current_longitude DECIMAL(10,7) NULL AFTER current_latitude, ADD COLUMN last_location_updated_at DATETIME NULL AFTER current_longitude`);
        console.log('[MIGRATION] Added pickup_requests live GPS tracking columns');
      }

      // 4. Notifications nullable created_by
      try {
        await connection.query(`ALTER TABLE notifications MODIFY COLUMN created_by BIGINT UNSIGNED NULL`);
      } catch (err) {
        // Ignored if already modified or constraint prevents
      }

      // New NGO registrations require an administrator approval. Existing
      // account states are retained; only the schema default changes.
      try {
        await connection.query("ALTER TABLE ngos MODIFY COLUMN account_status ENUM('active', 'pending', 'rejected', 'suspended') NOT NULL DEFAULT 'pending'");
      } catch (err) {
        console.warn('[MIGRATION] Could not update the NGO verification default:', err.message);
      }

      await connection.query(`CREATE TABLE IF NOT EXISTS donation_conversations (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, donation_id BIGINT UNSIGNED NOT NULL,
        donor_user_id BIGINT UNSIGNED NOT NULL, ngo_user_id BIGINT UNSIGNED NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id), UNIQUE KEY uq_donation_conversations_donation (donation_id),
        KEY idx_donation_conversations_donor (donor_user_id), KEY idx_donation_conversations_ngo (ngo_user_id),
        CONSTRAINT fk_donation_conversations_donation FOREIGN KEY (donation_id) REFERENCES donations(id) ON DELETE CASCADE,
        CONSTRAINT fk_donation_conversations_donor FOREIGN KEY (donor_user_id) REFERENCES users(id) ON DELETE CASCADE,
        CONSTRAINT fk_donation_conversations_ngo FOREIGN KEY (ngo_user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB`);
      await connection.query(`CREATE TABLE IF NOT EXISTS donation_messages (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, conversation_id BIGINT UNSIGNED NOT NULL,
        sender_user_id BIGINT UNSIGNED NOT NULL, recipient_user_id BIGINT UNSIGNED NOT NULL,
        body VARCHAR(2000) NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, read_at DATETIME NULL,
        PRIMARY KEY (id), KEY idx_donation_messages_conversation (conversation_id, created_at),
        KEY idx_donation_messages_unread (recipient_user_id, read_at),
        CONSTRAINT fk_donation_messages_conversation FOREIGN KEY (conversation_id) REFERENCES donation_conversations(id) ON DELETE CASCADE,
        CONSTRAINT fk_donation_messages_sender FOREIGN KEY (sender_user_id) REFERENCES users(id) ON DELETE CASCADE,
        CONSTRAINT fk_donation_messages_recipient FOREIGN KEY (recipient_user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB`);

      console.log('[MIGRATION] Food Rescue Database V3 Schema verified.');
    } finally {
      connection.release();
    }
  } catch (err) {
    console.warn('[MIGRATION] Auto-migration skipped or database offline:', err.message);
  }
}

module.exports = runAutoMigration;
module.exports.runAutoMigration = runAutoMigration;
