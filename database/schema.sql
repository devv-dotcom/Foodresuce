CREATE DATABASE IF NOT EXISTS foodbridge
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE foodbridge;

CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  full_name VARCHAR(120) NOT NULL,
  email VARCHAR(255) NOT NULL,
  mobile VARCHAR(20) NOT NULL,
  password VARCHAR(255) NOT NULL,
  role ENUM('admin', 'restaurant', 'hotel', 'bakery', 'supermarket', 'catering', 'marriage_hall', 'ngo', 'volunteer') NOT NULL,
  business_name VARCHAR(160) NULL,
  address VARCHAR(255) NOT NULL,
  city VARCHAR(100) NOT NULL,
  state VARCHAR(100) NOT NULL,
  pincode VARCHAR(12) NOT NULL,
  profile_image VARCHAR(500) NULL,
  is_verified BOOLEAN NOT NULL DEFAULT FALSE,
  account_status ENUM('active', 'pending', 'suspended', 'rejected', 'deleted') NOT NULL DEFAULT 'active',
  otp VARCHAR(255) NULL,
  otp_expires_at DATETIME NULL,
  login_otp VARCHAR(255) NULL,
  login_otp_expires_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email (email),
  KEY idx_users_role (role),
  KEY idx_users_otp_expiry (otp_expires_at),
  KEY idx_users_login_otp_expiry (login_otp_expires_at)
) ENGINE=InnoDB;
