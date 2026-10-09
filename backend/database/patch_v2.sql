-- Food Rescue Database Patch V2
-- Safe, non-destructive migration additions
USE foodbridge;

-- Safely add city column to donations table if not present
SET @dbname = DATABASE();
SET @tablename = 'donations';
SET @columnname = 'city';
SET @preparedStatement = (SELECT IF(
  (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @dbname
      AND TABLE_NAME = @tablename
      AND COLUMN_NAME = @columnname
  ) > 0,
  'SELECT 1',
  'ALTER TABLE donations ADD COLUMN city VARCHAR(100) NULL AFTER pickup_address;'
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- Safely add Food Safety Verification columns to donations table
SET @columnname2 = 'is_safety_verified';
SET @preparedStatement2 = (SELECT IF(
  (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @dbname
      AND TABLE_NAME = @tablename
      AND COLUMN_NAME = @columnname2
  ) > 0,
  'SELECT 1',
  'ALTER TABLE donations ADD COLUMN is_safety_verified BOOLEAN NOT NULL DEFAULT TRUE AFTER status;'
));
PREPARE alterIfNotExists2 FROM @preparedStatement2;
EXECUTE alterIfNotExists2;
DEALLOCATE PREPARE alterIfNotExists2;

-- New donor/business accounts are active on registration.
ALTER TABLE business_profiles
  MODIFY account_status ENUM('active', 'suspended', 'pending', 'rejected') NOT NULL DEFAULT 'active';

UPDATE business_profiles SET account_status = 'active' WHERE account_status <> 'active';

-- Existing NGO accounts are active without administrator approval.
ALTER TABLE ngos
  MODIFY account_status ENUM('active', 'pending', 'rejected', 'suspended') NOT NULL DEFAULT 'active';

UPDATE ngos SET account_status = 'active' WHERE account_status <> 'active';
