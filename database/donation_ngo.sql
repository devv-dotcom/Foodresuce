USE foodbridge;

CREATE TABLE IF NOT EXISTS food_categories (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(80) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_food_categories_name (name)
) ENGINE=InnoDB;

INSERT IGNORE INTO food_categories (name) VALUES
  ('Cooked Meals'), ('Bakery'), ('Fresh Produce'), ('Packaged Food'), ('Beverages'), ('Other');

CREATE TABLE IF NOT EXISTS donations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  business_user_id BIGINT UNSIGNED NOT NULL,
  category_id BIGINT UNSIGNED NOT NULL,
  food_name VARCHAR(160) NOT NULL,
  food_type ENUM('veg', 'non_veg') NOT NULL,
  quantity VARCHAR(80) NOT NULL,
  number_of_meals INT UNSIGNED NOT NULL DEFAULT 0,
  preparation_time DATETIME NOT NULL,
  expiry_time DATETIME NOT NULL,
  pickup_date DATE NOT NULL,
  pickup_time TIME NOT NULL,
  pickup_address VARCHAR(255) NOT NULL,
  latitude DECIMAL(10,7) NULL,
  longitude DECIMAL(10,7) NULL,
  description TEXT NULL,
  status ENUM('available', 'accepted', 'volunteer_assigned', 'picked_up', 'delivered', 'completed', 'cancelled') NOT NULL DEFAULT 'available',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_donations_business (business_user_id),
  KEY idx_donations_status_created (status, created_at),
  KEY idx_donations_pickup_date (pickup_date),
  CONSTRAINT fk_donations_business FOREIGN KEY (business_user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_donations_category FOREIGN KEY (category_id) REFERENCES food_categories(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS donation_images (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  donation_id BIGINT UNSIGNED NOT NULL,
  image_path VARCHAR(500) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_donation_images_donation (donation_id),
  CONSTRAINT fk_donation_images_donation FOREIGN KEY (donation_id) REFERENCES donations(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS ngos (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  ngo_name VARCHAR(160) NOT NULL,
  registration_number VARCHAR(100) NULL,
  account_status ENUM('active', 'pending', 'rejected', 'suspended') NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ngos_user (user_id),
  UNIQUE KEY uq_ngos_registration_number (registration_number),
  KEY idx_ngos_status (account_status),
  CONSTRAINT fk_ngos_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS ngo_profiles (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  ngo_id BIGINT UNSIGNED NOT NULL,
  mission TEXT NULL,
  service_area VARCHAR(160) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ngo_profiles_ngo (ngo_id),
  CONSTRAINT fk_ngo_profiles_ngo FOREIGN KEY (ngo_id) REFERENCES ngos(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS accepted_donations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  donation_id BIGINT UNSIGNED NOT NULL,
  ngo_id BIGINT UNSIGNED NOT NULL,
  accepted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status ENUM('accepted', 'volunteer_assigned', 'picked_up', 'delivered', 'completed', 'cancelled') NOT NULL DEFAULT 'accepted',
  PRIMARY KEY (id),
  UNIQUE KEY uq_accepted_donations_donation (donation_id),
  KEY idx_accepted_donations_ngo_status (ngo_id, status),
  CONSTRAINT fk_accepted_donations_donation FOREIGN KEY (donation_id) REFERENCES donations(id) ON DELETE CASCADE,
  CONSTRAINT fk_accepted_donations_ngo FOREIGN KEY (ngo_id) REFERENCES ngos(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS donation_conversations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  donation_id BIGINT UNSIGNED NOT NULL,
  donor_user_id BIGINT UNSIGNED NOT NULL,
  ngo_user_id BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_donation_conversations_donation (donation_id),
  KEY idx_donation_conversations_donor (donor_user_id),
  KEY idx_donation_conversations_ngo (ngo_user_id),
  CONSTRAINT fk_donation_conversations_donation FOREIGN KEY (donation_id) REFERENCES donations(id) ON DELETE CASCADE,
  CONSTRAINT fk_donation_conversations_donor FOREIGN KEY (donor_user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_donation_conversations_ngo FOREIGN KEY (ngo_user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS donation_messages (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  conversation_id BIGINT UNSIGNED NOT NULL,
  sender_user_id BIGINT UNSIGNED NOT NULL,
  recipient_user_id BIGINT UNSIGNED NOT NULL,
  body VARCHAR(2000) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  read_at DATETIME NULL,
  PRIMARY KEY (id),
  KEY idx_donation_messages_conversation (conversation_id, created_at),
  KEY idx_donation_messages_unread (recipient_user_id, read_at),
  CONSTRAINT fk_donation_messages_conversation FOREIGN KEY (conversation_id) REFERENCES donation_conversations(id) ON DELETE CASCADE,
  CONSTRAINT fk_donation_messages_sender FOREIGN KEY (sender_user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_donation_messages_recipient FOREIGN KEY (recipient_user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;
