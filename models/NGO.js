const pool = require('../config/database');
const geoService = require('../services/geoService');

module.exports = {
  async findByUserId(userId) {
    const [rows] = await pool.execute(
      `SELECT n.*, u.full_name, u.email, u.mobile, u.address, u.city, u.state, u.pincode, u.latitude, u.longitude, p.mission, p.service_area
       FROM ngos n JOIN users u ON u.id = n.user_id LEFT JOIN ngo_profiles p ON p.ngo_id = n.id WHERE n.user_id = ? LIMIT 1`,
      [userId]
    );
    return rows[0] || null;
  },

  async create(connection, userId, data) {
    const [result] = await connection.execute('INSERT INTO ngos (user_id, ngo_name, registration_number) VALUES (?, ?, ?)', [userId, data.ngoName, data.registrationNumber || null]);
    await connection.execute('INSERT INTO ngo_profiles (ngo_id, mission, service_area) VALUES (?, ?, ?)', [result.insertId, data.mission || null, data.serviceArea || null]);
    return result.insertId;
  },

  async update(connection, ngoId, data) {
    await connection.execute('UPDATE ngos SET ngo_name = ?, registration_number = ? WHERE id = ?', [data.ngoName, data.registrationNumber || null, ngoId]);
    await connection.execute('UPDATE ngo_profiles SET mission = ?, service_area = ? WHERE ngo_id = ?', [data.mission || null, data.serviceArea || null, ngoId]);
  },

  /**
   * Find nearby active NGOs based on donation latitude/longitude or city fallback.
   * Ranks NGOs by distance (in KM) up to radiusKm.
   */
  async findNearbyNGOs({ latitude, longitude, city, address, radiusKm = 10, limit = 5 }) {
    const coords = geoService.resolveCoordinates({ latitude, longitude, city, address });
    
    // Fetch active NGOs with location info
    const [rows] = await pool.execute(
      `SELECT n.id AS ngo_id, n.user_id, n.ngo_name, n.account_status,
              u.full_name, u.city, u.address, u.pincode, u.latitude, u.longitude,
              p.mission, p.service_area
       FROM ngos n
       JOIN users u ON u.id = n.user_id
       LEFT JOIN ngo_profiles p ON p.ngo_id = n.id
       WHERE (n.account_status = 'active' OR n.account_status IS NULL)
         AND u.role = 'ngo'`
    );

    if (!rows.length) return [];

    const nearbyList = [];

    for (const ngo of rows) {
      const ngoCoords = geoService.resolveCoordinates({
        latitude: ngo.latitude,
        longitude: ngo.longitude,
        city: ngo.city,
        address: ngo.address
      });

      let distKm = null;
      if (coords.latitude !== null && coords.longitude !== null && ngoCoords.latitude !== null && ngoCoords.longitude !== null) {
        distKm = geoService.calculateDistance(coords.latitude, coords.longitude, ngoCoords.latitude, ngoCoords.longitude);
      } else if (city && ngo.city && city.trim().toLowerCase() === ngo.city.trim().toLowerCase()) {
        // Same city match fallback if coordinates are missing
        distKm = 3.5;
      }

      if (distKm !== null && distKm <= Number(radiusKm)) {
        nearbyList.push({
          id: ngo.ngo_id,
          user_id: ngo.user_id,
          ngo_name: ngo.ngo_name || ngo.full_name || 'Food Rescue Partner',
          city: ngo.city || 'Local Area',
          distance_km: distKm,
          mission: ngo.mission || null,
          account_status: ngo.account_status || 'active'
        });
      }
    }

    // Rank by nearest distance
    nearbyList.sort((a, b) => a.distance_km - b.distance_km);

    return nearbyList.slice(0, limit);
  },

  // Exact-coordinate matching for donation alerts. Approximate city centroids
  // are not used to decide who receives a pickup notification.
  async findNearbyNGOsByCoordinates({ latitude, longitude, radiusKm = Number(process.env.NGO_MATCH_RADIUS_KM) || 35, connection = pool }) {
    if (latitude === null || latitude === undefined || latitude === '' || longitude === null || longitude === undefined || longitude === '') return [];
    const donorLat = Number(latitude);
    const donorLng = Number(longitude);
    const radius = Math.min(Math.max(Number(radiusKm) || 35, 1), 250);
    if (!Number.isFinite(donorLat) || donorLat < -90 || donorLat > 90 || !Number.isFinite(donorLng) || donorLng < -180 || donorLng > 180) return [];

    const [rows] = await connection.execute(
      `SELECT n.id AS ngo_id, u.id AS user_id, n.ngo_name, u.latitude, u.longitude
       FROM ngos n JOIN users u ON u.id = n.user_id
       WHERE n.account_status = 'active' AND u.role = 'ngo'
         AND u.latitude IS NOT NULL AND u.longitude IS NOT NULL`
    );
    return rows.map(row => ({
      ...row,
      distance_km: geoService.calculateDistance(donorLat, donorLng, row.latitude, row.longitude)
    })).filter(row => row.distance_km !== null && row.distance_km <= radius)
      .sort((a, b) => a.distance_km - b.distance_km);
  }
};
