-- Food Rescue Module 8: run after Modules 1-7 schemas.
USE foodbridge;

ALTER TABLE business_profiles
  MODIFY account_status ENUM('active', 'suspended', 'pending', 'rejected') NOT NULL DEFAULT 'active';
ALTER TABLE ngos
  MODIFY account_status ENUM('active', 'pending', 'suspended', 'rejected') NOT NULL DEFAULT 'active';
ALTER TABLE volunteers
  ADD COLUMN IF NOT EXISTS account_status ENUM('active', 'pending', 'suspended', 'rejected') NOT NULL DEFAULT 'active' AFTER availability;
ALTER TABLE donations
  ADD COLUMN IF NOT EXISTS deleted_at DATETIME NULL AFTER updated_at,
  ADD KEY idx_donations_deleted_status (deleted_at, status);
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS account_status ENUM('active', 'pending', 'suspended', 'rejected', 'deleted') NOT NULL DEFAULT 'active' AFTER is_verified;
ALTER TABLE food_categories
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE AFTER name,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at;

CREATE TABLE IF NOT EXISTS admins (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  account_status ENUM('active', 'suspended') NOT NULL DEFAULT 'active',
  last_login_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_admins_user (user_id),
  KEY idx_admins_status (account_status),
  CONSTRAINT fk_admins_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS reports (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  generated_by BIGINT UNSIGNED NOT NULL,
  report_type ENUM('daily', 'weekly', 'monthly', 'yearly', 'business', 'ngo', 'volunteer', 'donation') NOT NULL,
  report_date DATE NOT NULL,
  filters_json JSON NULL,
  data_json JSON NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_reports_type_date (report_type, report_date),
  CONSTRAINT fk_reports_admin FOREIGN KEY (generated_by) REFERENCES admins(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS analytics (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  metric_key VARCHAR(80) NOT NULL,
  metric_date DATE NOT NULL,
  metric_value DECIMAL(15,2) NOT NULL DEFAULT 0,
  dimensions_json JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_analytics_metric_day (metric_key, metric_date),
  KEY idx_analytics_metric_date (metric_key, metric_date)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS notifications (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  created_by BIGINT UNSIGNED NULL,
  recipient_user_id BIGINT UNSIGNED NULL,
  target_role ENUM('all', 'business', 'ngo', 'volunteer') NOT NULL DEFAULT 'all',
  title VARCHAR(160) NOT NULL,
  message TEXT NOT NULL,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  notification_type VARCHAR(60) NULL,
  related_donation_id BIGINT UNSIGNED NULL,
  dedupe_key VARCHAR(190) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_notifications_dedupe_key (dedupe_key),
  KEY idx_notifications_recipient_read (recipient_user_id, is_read, created_at),
  KEY idx_notifications_role_created (target_role, created_at),
  CONSTRAINT fk_notifications_admin FOREIGN KEY (created_by) REFERENCES admins(id) ON DELETE RESTRICT,
  CONSTRAINT fk_notifications_recipient FOREIGN KEY (recipient_user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS contact_messages (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(120) NOT NULL,
  email VARCHAR(255) NOT NULL,
  subject VARCHAR(200) NOT NULL,
  message TEXT NOT NULL,
  status ENUM('unread', 'read', 'replied') NOT NULL DEFAULT 'unread',
  replied_by BIGINT UNSIGNED NULL,
  reply_message TEXT NULL,
  replied_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_contact_messages_status_created (status, created_at),
  CONSTRAINT fk_contact_messages_admin FOREIGN KEY (replied_by) REFERENCES admins(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS reviews (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  reviewer_user_id BIGINT UNSIGNED NULL,
  reviewee_user_id BIGINT UNSIGNED NULL,
  rating TINYINT UNSIGNED NOT NULL,
  comment TEXT NULL,
  status ENUM('pending', 'approved', 'hidden') NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_reviews_status_created (status, created_at),
  KEY idx_reviews_reviewee (reviewee_user_id),
  CONSTRAINT chk_reviews_rating CHECK (rating BETWEEN 1 AND 5),
  CONSTRAINT fk_reviews_reviewer FOREIGN KEY (reviewer_user_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_reviews_reviewee FOREIGN KEY (reviewee_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS activity_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  actor_user_id BIGINT UNSIGNED NULL,
  action VARCHAR(100) NOT NULL,
  entity_type VARCHAR(60) NOT NULL,
  entity_id BIGINT UNSIGNED NULL,
  details_json JSON NULL,
  ip_address VARCHAR(45) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_activity_logs_actor_created (actor_user_id, created_at),
  KEY idx_activity_logs_entity (entity_type, entity_id),
  KEY idx_activity_logs_action_created (action, created_at),
  CONSTRAINT fk_activity_logs_actor FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS account_warnings (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  target_user_id BIGINT UNSIGNED NOT NULL,
  issued_by_user_id BIGINT UNSIGNED NULL,
  category VARCHAR(60) NOT NULL,
  reason TEXT NOT NULL,
  severity ENUM('low', 'medium', 'high') NOT NULL,
  status ENUM('issued', 'acknowledged', 'appealed', 'closed') NOT NULL DEFAULT 'issued',
  related_donation_id BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_account_warnings_target_created (target_user_id, created_at),
  KEY idx_account_warnings_issuer_created (issued_by_user_id, created_at),
  CONSTRAINT fk_account_warnings_target FOREIGN KEY (target_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_account_warnings_issuer FOREIGN KEY (issued_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_account_warnings_donation FOREIGN KEY (related_donation_id) REFERENCES donations(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS website_settings (
  setting_key VARCHAR(100) NOT NULL,
  setting_value JSON NOT NULL,
  updated_by BIGINT UNSIGNED NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (setting_key),
  CONSTRAINT fk_website_settings_admin FOREIGN KEY (updated_by) REFERENCES admins(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- Seed an admin only after creating an existing users record with role = 'admin':
-- INSERT INTO admins (user_id) SELECT id FROM users WHERE email = 'admin@example.com' AND role = 'admin';
