-- Adds a separate short-lived code for multi-factor sign-in.
-- Run once for existing Food Rescue databases.
USE foodbridge;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS login_otp VARCHAR(255) NULL AFTER otp_expires_at,
  ADD COLUMN IF NOT EXISTS login_otp_expires_at DATETIME NULL AFTER login_otp;

SET @dbname = DATABASE();
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
   WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'users' AND INDEX_NAME = 'idx_users_login_otp_expiry') > 0,
  'SELECT 1',
  'ALTER TABLE users ADD KEY idx_users_login_otp_expiry (login_otp_expires_at);'
));
PREPARE addLoginOtpIndex FROM @preparedStatement;
EXECUTE addLoginOtpIndex;
DEALLOCATE PREPARE addLoginOtpIndex;
