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
  pickup_city VARCHAR(100) NULL,
  pickup_pincode VARCHAR(12) NULL,
  storage_condition VARCHAR(20) NOT NULL DEFAULT 'ambient',
  safety_hygiene_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  safety_storage_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  safety_deadline_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  safety_accuracy_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
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
  account_status ENUM('active', 'pending', 'suspended') NOT NULL DEFAULT 'active',
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
