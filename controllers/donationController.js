const path = require('path');
const pool = require('../config/database');
const Donation = require('../models/Donation');
const DonationImage = require('../models/DonationImage');
const NGO = require('../models/NGO');
const geoService = require('../services/geoService');
const { sendNotification, awardPoints } = require('../utils/notify');
const { safetyDeclarationComplete, donationWindowError } = require('../utils/donationSafety');

const imagePaths = files => (files || []).map(file => `/${path.relative(path.join(__dirname, '..'), file.path).split(path.sep).join('/')}`);
const pagination = query => ({ limit: Math.min(Math.max(Number(query.limit) || 20, 1), 100), offset: Math.max(Number(query.offset) || 0, 0) });
const getNgoScope = async req => {
  if (req.user.role !== 'ngo') return null;
  const profile = await NGO.findByUserId(req.user.id);
  const hasQueryLocation = req.query.latitude !== undefined || req.query.longitude !== undefined;
  const latitude = hasQueryLocation ? Number(req.query.latitude) : Number(profile?.latitude);
  const longitude = hasQueryLocation ? Number(req.query.longitude) : Number(profile?.longitude);
  const validCoordinates = (hasQueryLocation || (profile?.latitude != null && profile?.longitude != null))
    && Number.isFinite(latitude) && Math.abs(latitude) <= 90 && Number.isFinite(longitude) && Math.abs(longitude) <= 180;
  if (validCoordinates) {
    const radius = Math.min(Math.max(Number(req.query.radiusKm) || Number(process.env.NGO_MATCH_RADIUS_KM) || 35, 1), 250);
    return {
      clause: 'd.latitude IS NOT NULL AND d.longitude IS NOT NULL AND (6371 * ACOS(LEAST(1.0, GREATEST(-1.0, COS(RADIANS(?)) * COS(RADIANS(d.latitude)) * COS(RADIANS(d.longitude) - RADIANS(?)) + SIN(RADIANS(?)) * SIN(RADIANS(d.latitude)))))) <= ?',
      values: [latitude, longitude, latitude, radius],
      location: { type: 'coordinates', latitude, longitude, radius }
    };
  }
  if (hasQueryLocation) return { clause: '1 = 0', values: [] };
  if (!profile?.city) return { clause: '1 = 0', values: [] };
  return { clause: 'LOWER(COALESCE(d.pickup_city, u.city)) = LOWER(?)', values: [profile.city.trim()], location: { type: 'city', city: profile.city.trim() } };
};
const combineScope = (where, values, scope) => {
  if (!scope) return { where, values };
  return {
    where: where ? `${where} AND (${scope.clause})` : `WHERE ${scope.clause}`,
    values: [...values, ...scope.values]
  };
};

const enrichWithCountdown = d => {
  if (!d) return d;
  const now = Date.now();
  const expiry = new Date(d.expiry_time).getTime();
  const diffMs = expiry - now;
  const diffHours = diffMs / (1000 * 60 * 60);
  const diffMins = Math.max(0, Math.floor(diffMs / (1000 * 60)));
  const hrs = Math.floor(diffMins / 60);
  const mins = diffMins % 60;
  
  return {
    ...d,
    hours_remaining: Number(diffHours.toFixed(1)),
    is_urgent: diffHours <= 2.5 && diffHours > 0,
    is_expired: diffMs <= 0,
    countdown_text: diffMs <= 0 ? 'Expired' : `${hrs}h ${mins}m left`
  };
};

exports.createDonation = async (req, res, next) => {
  if (!req.files?.length) return res.status(422).json({ success: false, message: 'At least one food image is required.' });
  const windowError = donationWindowError(req.body);
  if (windowError) return res.status(422).json({ success: false, message: windowError });
  if (!safetyDeclarationComplete(req.body)) {
    return res.status(422).json({ success: false, message: 'Complete each donor food-handling declaration before publishing this donation.' });
  }
  let connection;
  try {
    connection = await pool.getConnection();
    if (!await Donation.categoryExists(req.body.categoryId)) return res.status(422).json({ success: false, message: 'Selected food category does not exist.' });
    await connection.beginTransaction();
    const donationId = await Donation.create(connection, req.user.id, req.body);
    await DonationImage.createMany(connection, donationId, imagePaths(req.files));
    
    // Award 25 listing points to donor
    await awardPoints(req.user.id, 25, connection);

    // Persist one deduplicated alert per eligible NGO with an explicit,
    // stored location inside the configured matching radius.
    const isUrgent = (new Date(req.body.expiryTime).getTime() - Date.now()) <= 2.5 * 3600000;
    const nearbyNgos = await NGO.findNearbyNGOsByCoordinates({
      latitude: req.body.latitude,
      longitude: req.body.longitude,
      connection
    });
    for (const ngo of nearbyNgos) {
      await sendNotification({
        recipientUserId: ngo.user_id,
        targetRole: 'ngo',
        notificationType: 'new_donation',
        donationId,
        title: isUrgent ? '🚨 URGENT: Food Donation Needs Rescue' : '🍲 New Food Donation Available',
        message: `${req.body.foodName} (${req.body.quantity}) is available ${ngo.distance_km} km from your registered location.`,
        connection
      });
    }

    const createdDonation = enrichWithCountdown(await Donation.findById(donationId));
    await connection.commit();
    return res.status(201).json({ success: true, message: 'Donation published. Donor food-handling declarations were recorded.', donation: createdDonation });
  } catch (error) {
    if (connection) {
      try { await connection.rollback(); } catch (_) {}
    }
    next(error);
  } finally {
    connection?.release();
  }
};

exports.getDonation = async (req, res, next) => {
  try {
    const donation = await Donation.findById(req.params.id);
    if (!donation) return res.status(404).json({ success: false, message: 'Donation not found.' });
    if (req.user.role === 'ngo') {
      const scope = await getNgoScope(req);
      const [ngo] = await pool.execute('SELECT id FROM ngos WHERE user_id = ? LIMIT 1', [req.user.id]);
      const [assigned] = ngo?.length ? await pool.execute('SELECT id FROM accepted_donations WHERE donation_id = ? AND ngo_id = ? LIMIT 1', [donation.id, ngo[0].id]) : [[]];
      const location = scope?.location;
      const distanceKm = location?.type === 'coordinates'
        ? geoService.calculateDistance(location.latitude, location.longitude, donation.latitude, donation.longitude)
        : null;
      const eligibleByDistance = distanceKm !== null && distanceKm <= location.radius;
      const eligibleByCity = location?.type === 'city'
        && String(donation.pickup_city || donation.business_city || '').toLowerCase() === location.city.toLowerCase();
      const canView = (donation.status === 'available' && (eligibleByDistance || eligibleByCity)) || assigned.length > 0;
      if (!canView) return res.status(403).json({ success: false, message: 'This donation is outside your eligible area or is assigned to another NGO.' });
    } else if (req.user.role !== 'admin' && donation.business_user_id !== req.user.id) {
      return res.status(403).json({ success: false, message: 'You do not have access to this donation.' });
    }
    donation.images = await Donation.getImages(donation.id);
    return res.json({ success: true, donation: enrichWithCountdown(donation) });
  } catch (error) { next(error); }
};

exports.getAllDonations = async (req, res, next) => {
  try {
    const scope = await getNgoScope(req);
    const baseWhere = req.user.role === 'ngo' ? "WHERE d.status = 'available' AND d.expiry_time > NOW()" : '';
    const { where, values } = combineScope(baseWhere, [], scope);
    const list = await Donation.list({ ...pagination(req.query), where, values });
    return res.json({ success: true, donations: list.map(enrichWithCountdown) });
  } catch (error) { next(error); }
};

exports.searchDonation = async (req, res, next) => {
  try {
    const term = `%${(req.query.q || '').trim()}%`;
    if (term === '%%') return res.status(422).json({ success: false, message: 'Provide a search term.' });
    const availableOnly = req.user.role === 'ngo' ? "(d.status = 'available' AND d.expiry_time > NOW()) AND " : '';
    const where = `WHERE ${availableOnly}(d.food_name LIKE ? OR c.name LIKE ? OR u.city LIKE ? OR u.business_name LIKE ? OR d.status LIKE ?)`;
    const scope = await getNgoScope(req);
    const scoped = combineScope(where, [term, term, term, term, term], scope);
    const list = await Donation.list({ where: scoped.where, values: scoped.values, ...pagination(req.query) });
    return res.json({ success: true, donations: list.map(enrichWithCountdown) });
  } catch (error) { next(error); }
};

exports.filterDonation = async (req, res, next) => {
  try {
    const clauses = []; const values = [];
    if (req.query.foodType) { clauses.push('d.food_type = ?'); values.push(req.query.foodType); }
    if (req.query.status) { clauses.push('d.status = ?'); values.push(req.query.status); }
    if (req.query.categoryId) { clauses.push('d.category_id = ?'); values.push(Number(req.query.categoryId)); }
    if (req.query.today === 'true') { clauses.push('d.pickup_date = CURDATE()'); }
    if (req.query.city) { clauses.push('u.city = ?'); values.push(req.query.city); }
    if (req.query.latitude && req.query.longitude) {
      const latitude = Number(req.query.latitude);
      const longitude = Number(req.query.longitude);
      const radiusKm = Math.min(Math.max(Number(req.query.radiusKm) || 10, 1), 100);
      if (Number.isNaN(latitude) || Number.isNaN(longitude)) return res.status(422).json({ success: false, message: 'Nearby filtering needs valid latitude and longitude values.' });
      clauses.push('d.latitude IS NOT NULL AND d.longitude IS NOT NULL AND (6371 * ACOS(COS(RADIANS(?)) * COS(RADIANS(d.latitude)) * COS(RADIANS(d.longitude) - RADIANS(?)) + SIN(RADIANS(?)) * SIN(RADIANS(d.latitude)))) <= ?');
      values.push(latitude, longitude, latitude, radiusKm);
    }
    if (req.user.role === 'ngo') clauses.push("d.status = 'available'", 'd.expiry_time > NOW()');
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const scoped = combineScope(where, values, await getNgoScope(req));
    const list = await Donation.list({ where: scoped.where, values: scoped.values, ...pagination(req.query) });
    return res.json({ success: true, donations: list.map(enrichWithCountdown) });
  } catch (error) { next(error); }
};

exports.getEmergencyDonations = async (req, res, next) => {
  try {
    const scope = await getNgoScope(req);
    const scopedWhere = scope ? `AND (${scope.clause})` : '';
    const [rows] = await pool.execute(`
      SELECT d.*, c.name AS category_name, u.business_name, u.full_name AS owner_name, u.city AS business_city,
        (SELECT image_path FROM donation_images WHERE donation_id = d.id ORDER BY id ASC LIMIT 1) AS food_image
      FROM donations d
      JOIN food_categories c ON c.id = d.category_id
      JOIN users u ON u.id = d.business_user_id
      WHERE d.status = 'available' AND d.deleted_at IS NULL AND d.expiry_time > NOW()
        AND (d.is_emergency = TRUE OR d.expiry_time <= DATE_ADD(NOW(), INTERVAL 2 HOUR)) ${scopedWhere}
      ORDER BY d.expiry_time ASC
      LIMIT 20
    `, scope?.values || []);
    return res.json({ success: true, donations: rows.map(enrichWithCountdown) });
  } catch (error) { next(error); }
};

exports.emergencyBroadcast = async (req, res, next) => {
  try {
    const donation = await Donation.findById(req.params.id);
    if (!donation) return res.status(404).json({ success: false, message: 'Donation not found.' });
    if (donation.business_user_id !== req.user.id) return res.status(403).json({ success: false, message: 'You can only broadcast an emergency for your own donation.' });
    if (donation.status !== 'available' || new Date(donation.expiry_time) <= new Date()) return res.status(409).json({ success: false, message: 'Only available, unexpired donations can be broadcast as emergencies.' });

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.execute("UPDATE donations SET is_emergency = TRUE WHERE id = ? AND status = 'available' AND expiry_time > NOW()", [donation.id]);
      const nearbyNgos = await NGO.findNearbyNGOsByCoordinates({ latitude: donation.latitude, longitude: donation.longitude, connection });
      for (const ngo of nearbyNgos) {
        await sendNotification({
          recipientUserId: ngo.user_id,
          targetRole: 'ngo',
          notificationType: 'emergency_donation',
          donationId: donation.id,
          title: '🚨 EMERGENCY RESCUE BROADCAST',
          message: `URGENT RESCUE: ${donation.food_name} (${donation.quantity}) needs immediate acceptance.`,
          connection
        });
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally { connection.release(); }

    return res.json({ success: true, message: 'Emergency status saved. Nearby active NGOs with saved coordinates were notified when eligible.' });
  } catch (error) { next(error); }
};

exports.updateDonation = async (req, res, next) => {
  try {
    const windowError = donationWindowError(req.body);
    if (windowError) return res.status(422).json({ success: false, message: windowError });
    if (!safetyDeclarationComplete(req.body)) return res.status(422).json({ success: false, message: 'Complete each donor food-handling declaration before updating this donation.' });
    if (!await Donation.categoryExists(req.body.categoryId)) return res.status(422).json({ success: false, message: 'Selected food category does not exist.' });
    const updated = await Donation.update(req.params.id, req.user.id, req.body);
    if (!updated) return res.status(404).json({ success: false, message: 'Donation not found, unavailable, or cannot be edited after acceptance.' });
    if (req.files?.length) await DonationImage.addMany(req.params.id, imagePaths(req.files));
    return res.json({ success: true, message: 'Donation updated successfully.', donation: enrichWithCountdown(await Donation.findById(req.params.id)) });
  } catch (error) { next(error); }
};

exports.deleteDonation = async (req, res, next) => {
  try {
    const deleted = await Donation.delete(req.params.id, req.user.id);
    if (!deleted) return res.status(404).json({ success: false, message: 'Donation not found or cannot be deleted after acceptance.' });
    return res.json({ success: true, message: 'Donation cancelled successfully.' });
  } catch (error) { next(error); }
};
