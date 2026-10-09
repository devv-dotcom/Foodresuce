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
      const ensureIndex = async (table, index, definition) => {
        const [rows] = await connection.query(
          'SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME = ?',
          [dbName, table, index]
        );
        if (!rows[0].cnt) await connection.query(`ALTER TABLE ${table} ADD ${definition}`);
      };

      // 1. Users table additions
      await ensureColumn('users', 'login_otp', 'VARCHAR(255) NULL');
      await ensureColumn('users', 'login_otp_expires_at', 'DATETIME NULL');
      await ensureIndex('users', 'idx_users_login_otp_expiry', 'KEY idx_users_login_otp_expiry (login_otp_expires_at)');
      if (!(await helperCheckColumn('users', 'impact_points'))) {
        await connection.query(`ALTER TABLE users ADD COLUMN impact_points INT UNSIGNED NOT NULL DEFAULT 0 AFTER is_verified`);
        console.log('[MIGRATION] Added users.impact_points');
      }
      if (!(await helperCheckColumn('users', 'badge_level'))) {
        await connection.query(`ALTER TABLE users ADD COLUMN badge_level VARCHAR(50) NOT NULL DEFAULT 'Bronze Hero' AFTER impact_points`);
        console.log('[MIGRATION] Added users.badge_level');
      }
      // Check each coordinate field independently. A partial earlier migration
      // may have created latitude without longitude; checking only latitude
      // would leave NGO feed/profile queries failing on the missing column.
      await ensureColumn('users', 'latitude', 'DECIMAL(10,7) NULL AFTER pincode');
      await ensureColumn('users', 'longitude', 'DECIMAL(10,7) NULL AFTER latitude');

      // 2. Donations table additions
      // The full admin-module SQL adds these fields, but Render startup only
      // runs this additive migration. Donation feeds and category validation
      // query both columns, so ensure older databases receive them here too.
      await ensureColumn('donations', 'deleted_at', 'DATETIME NULL AFTER updated_at');
      await ensureIndex('donations', 'idx_donations_deleted_status', 'KEY idx_donations_deleted_status (deleted_at, status)');
      await ensureColumn('food_categories', 'is_active', 'BOOLEAN NOT NULL DEFAULT TRUE AFTER name');
      await ensureColumn('food_categories', 'updated_at', 'TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at');
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

      // NGO-led pickup/distribution reuses the existing pickup and proof tables.
      await ensureColumn('pickup_requests', 'pickup_scheduled_at', 'DATETIME NULL');
      await ensureColumn('pickup_requests', 'pickup_started_at', 'DATETIME NULL');
      await ensureColumn('pickup_requests', 'food_collected_at', 'DATETIME NULL');
      await ensureColumn('pickup_requests', 'distribution_started_at', 'DATETIME NULL');
      await ensureColumn('pickup_requests', 'distribution_completed_at', 'DATETIME NULL');
      await ensureColumn('pickup_requests', 'people_served', 'INT UNSIGNED NULL');
      await ensureColumn('pickup_requests', 'distribution_location', 'VARCHAR(255) NULL');
      await ensureColumn('pickup_requests', 'distribution_notes', 'VARCHAR(1000) NULL');
      await connection.query("ALTER TABLE pickup_requests MODIFY COLUMN status ENUM('pending', 'pickup_scheduled', 'volunteer_assigned', 'pickup_started', 'food_collected', 'on_the_way', 'delivered', 'completed', 'cancelled') NOT NULL DEFAULT 'pending'");
      await connection.query("ALTER TABLE donations MODIFY COLUMN status ENUM('available', 'accepted', 'pickup_scheduled', 'pickup_started', 'volunteer_assigned', 'picked_up', 'food_collected', 'distributed', 'delivered', 'completed', 'cancelled') NOT NULL DEFAULT 'available'");
      await connection.query("ALTER TABLE accepted_donations MODIFY COLUMN status ENUM('accepted', 'pickup_scheduled', 'pickup_started', 'volunteer_assigned', 'picked_up', 'food_collected', 'distributed', 'delivered', 'completed', 'cancelled') NOT NULL DEFAULT 'accepted'");

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

      // 4. Persisted, recipient-scoped notification metadata and deduplication.
      const [notificationTableRows] = await connection.query(
        'SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?',
        [dbName, 'notifications']
      );
      if (notificationTableRows[0].cnt > 0) {
        await ensureColumn('notifications', 'notification_type', 'VARCHAR(60) NULL');
        await ensureColumn('notifications', 'related_donation_id', 'BIGINT UNSIGNED NULL');
        await ensureColumn('notifications', 'dedupe_key', 'VARCHAR(190) NULL');
        await ensureIndex('notifications', 'uq_notifications_dedupe_key', 'UNIQUE KEY uq_notifications_dedupe_key (dedupe_key)');
      }

      // Automated workflow notifications have no admin actor.
      await connection.query(`ALTER TABLE notifications MODIFY COLUMN created_by BIGINT UNSIGNED NULL`);

      // NGOs and donor/business accounts are active immediately without
      // administrator approval. Activate existing accounts during deployment.
      try {
        await connection.query("ALTER TABLE ngos MODIFY COLUMN account_status ENUM('active', 'pending', 'rejected', 'suspended') NOT NULL DEFAULT 'active'");
        await connection.query("UPDATE ngos SET account_status = 'active' WHERE account_status <> 'active'");
      } catch (err) {
        console.warn('[MIGRATION] Could not activate existing NGO accounts:', err.message);
      }
      try {
        await connection.query("ALTER TABLE business_profiles MODIFY COLUMN account_status ENUM('active', 'suspended', 'pending', 'rejected') NOT NULL DEFAULT 'active'");
        await connection.query("UPDATE business_profiles SET account_status = 'active' WHERE account_status <> 'active'");
      } catch (err) {
        console.warn('[MIGRATION] Could not activate existing donor/business accounts:', err.message);
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
