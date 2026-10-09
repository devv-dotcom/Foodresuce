const pool = require('../config/database');
const geoService = require('../services/geoService');
const normalizeCity = value => String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
  .split(',')[0].trim().toLocaleLowerCase().replace(/\s+/g, ' ');

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
    const [result] = await connection.execute("INSERT INTO ngos (user_id, ngo_name, registration_number, account_status) VALUES (?, ?, ?, 'active')", [userId, data.ngoName, data.registrationNumber || null]);
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

  // Prefer exact coordinates, with an exact city-name fallback when either
  // side has no usable GPS. City matches carry no invented distance value.
  async findNearbyNGOsByCoordinates({ latitude, longitude, city, pincode, radiusKm = Number(process.env.NGO_MATCH_RADIUS_KM) || 35, connection = pool }) {
    const hasLatitude = latitude !== null && latitude !== undefined && latitude !== '';
    const hasLongitude = longitude !== null && longitude !== undefined && longitude !== '';
    const donorLat = hasLatitude ? Number(latitude) : null;
    const donorLng = hasLongitude ? Number(longitude) : null;
    const radius = Math.min(Math.max(Number(radiusKm) || 35, 1), 250);
    const hasCoordinates = Number.isFinite(donorLat) && donorLat >= -90 && donorLat <= 90
      && Number.isFinite(donorLng) && donorLng >= -180 && donorLng <= 180;
    const donorCity = String(city || '').trim();
    const donorPincode = String(pincode || '').replace(/\D/g, '');
    if (!hasCoordinates && !donorCity && !donorPincode) return [];

    const [rows] = await connection.execute(
      `SELECT n.id AS ngo_id, u.id AS user_id, n.ngo_name, u.city, u.pincode, u.latitude, u.longitude
       FROM ngos n JOIN users u ON u.id = n.user_id
       WHERE n.account_status = 'active' AND u.role = 'ngo'`
    );
    return rows.map(row => {
      const distanceKm = hasCoordinates
        ? geoService.calculateDistance(donorLat, donorLng, row.latitude, row.longitude)
        : null;
      const sameCity = Boolean(donorCity && normalizeCity(donorCity) === normalizeCity(row.city));
      const ngoPincode = String(row.pincode || '').replace(/\D/g, '');
      const samePincode = Boolean(donorPincode && ngoPincode && donorPincode === ngoPincode);
      return { ...row, distance_km: distanceKm, same_city: sameCity, same_pincode: samePincode };
    }).filter(row => (row.distance_km !== null && row.distance_km <= radius) || row.same_city || row.same_pincode)
      .sort((a, b) => {
        const aHasDistance = Number.isFinite(a.distance_km);
        const bHasDistance = Number.isFinite(b.distance_km);
        if (aHasDistance && bHasDistance) return a.distance_km - b.distance_km;
        if (aHasDistance !== bHasDistance) return aHasDistance ? -1 : 1;
        if (a.same_pincode !== b.same_pincode) return a.same_pincode ? -1 : 1;
        return 0;
      });
  }
};
