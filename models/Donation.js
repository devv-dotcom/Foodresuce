const pool = require('../config/database');
const normalizeCoordinate = value => value === '' || value === undefined || value === null ? null : Number(value);

const selectDonation = `
  SELECT d.*, c.name AS category_name, u.business_name, u.full_name AS owner_name, u.city AS business_city,
    (SELECT image_path FROM donation_images WHERE donation_id = d.id ORDER BY id ASC LIMIT 1) AS food_image,
    (SELECT n.ngo_name FROM accepted_donations ad JOIN ngos n ON n.id = ad.ngo_id WHERE ad.donation_id = d.id LIMIT 1) AS ngo_name
  FROM donations d
  JOIN food_categories c ON c.id = d.category_id
  JOIN users u ON u.id = d.business_user_id
`;

const Donation = {
  async categoryExists(categoryId) {
    const [rows] = await pool.execute('SELECT id FROM food_categories WHERE id = ? AND is_active = TRUE LIMIT 1', [categoryId]);
    return Boolean(rows[0]);
  },

  async create(connection, businessUserId, data) {
    const [result] = await connection.execute(
      `INSERT INTO donations (business_user_id, category_id, food_name, food_type, quantity, number_of_meals,
        preparation_time, expiry_time, pickup_date, pickup_time, pickup_address, pickup_city, pickup_pincode,
        storage_condition, safety_hygiene_confirmed, safety_storage_confirmed, safety_deadline_confirmed,
        safety_accuracy_confirmed, latitude, longitude, description)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [businessUserId, data.categoryId, data.foodName, data.foodType, data.quantity, data.numberOfMeals || 0,
        new Date(data.preparationTime), new Date(data.expiryTime), data.pickupDate, data.pickupTime, data.pickupAddress,
        data.city || null, data.pincode || null, data.storage || 'ambient',
        data.safetyHygiene === true || data.safetyHygiene === 'true' || data.safetyHygiene === 'on',
        data.safetyFreshness === true || data.safetyFreshness === 'true' || data.safetyFreshness === 'on',
        data.safetyPackaging === true || data.safetyPackaging === 'true' || data.safetyPackaging === 'on',
        data.safetyAccuracy === true || data.safetyAccuracy === 'true' || data.safetyAccuracy === 'on',
        normalizeCoordinate(data.latitude), normalizeCoordinate(data.longitude), data.description || null]
    );
    return result.insertId;
  },

  async findById(id) {
    const [rows] = await pool.execute(`${selectDonation} WHERE d.id = ? AND d.deleted_at IS NULL LIMIT 1`, [id]);
    return rows[0] || null;
  },

  async getImages(donationId) {
    const [rows] = await pool.execute('SELECT id, image_path FROM donation_images WHERE donation_id = ? ORDER BY id ASC', [donationId]);
    return rows;
  },

  async list({ where = '', values = [], limit = 20, offset = 0, includeDeleted = false }) {
    const combinedWhere = includeDeleted ? where : (where ? `${where} AND d.deleted_at IS NULL` : 'WHERE d.deleted_at IS NULL');
    // TiDB rejects prepared-statement placeholders in LIMIT/OFFSET. Embed
    // only validated integers while keeping all filter values parameterized.
    const requestedLimit = Number(limit);
    const requestedOffset = Number(offset);
    const safeLimit = Number.isSafeInteger(requestedLimit) && requestedLimit > 0
      ? Math.min(requestedLimit, 500)
      : 20;
    const safeOffset = Number.isSafeInteger(requestedOffset) && requestedOffset >= 0
      ? requestedOffset
      : 0;
    const pageSql = `LIMIT ${safeLimit} OFFSET ${safeOffset}`;
    try {
      const [rows] = await pool.execute(`${selectDonation} ${combinedWhere} ORDER BY d.created_at DESC ${pageSql}`, values);
      return rows;
    } catch (error) {
      // Some production databases predate the soft-delete migration. A
      // legacy donation deleted by this app is also marked cancelled, so
      // status-eligible feeds remain safe while the migration is repaired.
      const isAvailableFeed = /\bd\.status\s*=\s*['"]available['"]/i.test(where);
      if (includeDeleted || !isAvailableFeed || error.code !== 'ER_BAD_FIELD_ERROR' || !/deleted_at/i.test(error.sqlMessage || '')) throw error;
      const legacyWhere = combinedWhere
        .replace(/\s+AND\s+d\.deleted_at\s*=\s*NULL/i, '')
        .replace(/\s+AND\s+d\.deleted_at\s+IS\s+NULL/i, '')
        .replace(/^WHERE\s+d\.deleted_at\s+IS\s+NULL\s*$/i, '');
      const [rows] = await pool.execute(`${selectDonation} ${legacyWhere} ORDER BY d.created_at DESC ${pageSql}`, values);
      console.warn('[Donations] Serving legacy schema while deleted_at migration is pending.');
      return rows;
    }
  },
  async update(id, businessUserId, data) {
    const [result] = await pool.execute(
      `UPDATE donations SET category_id = ?, food_name = ?, food_type = ?, quantity = ?, number_of_meals = ?,
       preparation_time = ?, expiry_time = ?, pickup_date = ?, pickup_time = ?, pickup_address = ?, pickup_city = ?, pickup_pincode = ?,
       storage_condition = ?, safety_hygiene_confirmed = ?, safety_storage_confirmed = ?, safety_deadline_confirmed = ?, safety_accuracy_confirmed = ?,
       latitude = ?, longitude = ?, description = ?
       WHERE id = ? AND business_user_id = ? AND status = 'available' AND deleted_at IS NULL`,
      [data.categoryId, data.foodName, data.foodType, data.quantity, data.numberOfMeals || 0, new Date(data.preparationTime),
        new Date(data.expiryTime), data.pickupDate, data.pickupTime, data.pickupAddress, data.city || null, data.pincode || null,
        data.storage || 'ambient',
        data.safetyHygiene === true || data.safetyHygiene === 'true' || data.safetyHygiene === 'on',
        data.safetyFreshness === true || data.safetyFreshness === 'true' || data.safetyFreshness === 'on',
        data.safetyPackaging === true || data.safetyPackaging === 'true' || data.safetyPackaging === 'on',
        data.safetyAccuracy === true || data.safetyAccuracy === 'true' || data.safetyAccuracy === 'on',
        normalizeCoordinate(data.latitude), normalizeCoordinate(data.longitude), data.description || null, id, businessUserId]
    );
    if (result.affectedRows) return result.affectedRows;
    // MySQL can report zero changed rows when an available listing is saved
    // with the same values. Treat an owned, still-editable row as success.
    const [rows] = await pool.execute("SELECT id FROM donations WHERE id = ? AND business_user_id = ? AND status = 'available' AND deleted_at IS NULL LIMIT 1", [id, businessUserId]);
    return rows.length;
  },

  async delete(id, businessUserId) {
    const [result] = await pool.execute("UPDATE donations SET deleted_at = CURRENT_TIMESTAMP, status = 'cancelled' WHERE id = ? AND business_user_id = ? AND status = 'available' AND deleted_at IS NULL", [id, businessUserId]);
    return result.affectedRows;
  }
};

module.exports = Donation;
