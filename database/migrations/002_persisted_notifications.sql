-- Food Rescue migration 002: persisted recipient notification metadata.
-- Apply once to databases initialized before the app's additive migration.
-- Preserve existing notification records; new columns default to NULL.
USE foodbridge;

ALTER TABLE notifications
  MODIFY COLUMN created_by BIGINT UNSIGNED NULL,
  ADD COLUMN notification_type VARCHAR(60) NULL AFTER is_read,
  ADD COLUMN related_donation_id BIGINT UNSIGNED NULL AFTER notification_type,
  ADD COLUMN dedupe_key VARCHAR(190) NULL AFTER related_donation_id,
  ADD UNIQUE KEY uq_notifications_dedupe_key (dedupe_key);
