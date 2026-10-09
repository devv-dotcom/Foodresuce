const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('../config/database');
const User = require('../models/User');
const NGO = require('../models/NGO');
const Donation = require('../models/Donation');
const AcceptedDonation = require('../models/AcceptedDonation');
const DeliveryProof = require('../models/DeliveryProof');
const { sendNotification, awardPoints } = require('../utils/notify');
const { getUrgency, scoreDonationForNgo, urgencyRank } = require('../services/rescueEngine');

const tokenFor = user => jwt.sign({ sub: user.id, role: 'ngo' }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });
const normalizeCity = value => String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
  .split(',')[0].trim().toLocaleLowerCase().replace(/\s+/g, ' ');

const enrichWithCountdown = (d, userLat = null, userLon = null) => {
  if (!d) return d;
  const now = Date.now();
  const expiry = new Date(d.expiry_time).getTime();
  const diffMs = expiry - now;
  const diffHours = diffMs / (1000 * 60 * 60);
  const diffMins = Math.max(0, Math.floor(diffMs / (1000 * 60)));
  const hrs = Math.floor(diffMins / 60);
  const mins = diffMins % 60;

  let distanceKm = null;
  const donationLat = Number(d.latitude);
  const donationLon = Number(d.longitude);
  if (userLat !== null && userLon !== null && d.latitude !== null && d.longitude !== null
      && Number.isFinite(userLat) && Number.isFinite(userLon)
      && Number.isFinite(donationLat) && Math.abs(donationLat) <= 90
      && Number.isFinite(donationLon) && Math.abs(donationLon) <= 180) {
    const R = 6371;
    const dLat = (donationLat - userLat) * Math.PI / 180;
    const dLon = (donationLon - userLon) * Math.PI / 180;
    const rawA = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(userLat * Math.PI / 180) * Math.cos(donationLat * Math.PI / 180) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const a = Math.max(0, Math.min(1, rawA));
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    distanceKm = Number((R * c).toFixed(1));
  }
  
  return {
    ...d,
    distance_km: distanceKm,
    ...getUrgency(d.expiry_time, now),
    hours_remaining: Number(diffHours.toFixed(1)),
    is_urgent: diffHours <= 2.5 && diffHours > 0,
    is_expired: diffMs <= 0,
    countdown_text: diffMs <= 0 ? 'Expired' : `${hrs}h ${mins}m left`
  };
};

exports.registerNGO = async (req, res, next) => {
  const connection = await pool.getConnection();
  try {
    if (await User.findByEmail(req.body.email)) return res.status(409).json({ success: false, message: 'An account with this email already exists.' });
    await connection.beginTransaction();
    const password = await bcrypt.hash(req.body.password, 12);
    const [userResult] = await connection.execute(
      `INSERT INTO users (full_name, email, mobile, password, role, address, city, state, pincode, latitude, longitude)
       VALUES (?, ?, ?, ?, 'ngo', ?, ?, ?, ?, ?, ?)`,
      [req.body.fullName, req.body.email.toLowerCase(), req.body.mobile, password, req.body.address, req.body.city, req.body.state, req.body.pincode, req.body.latitude ?? null, req.body.longitude ?? null]
    );
    await NGO.create(connection, userResult.insertId, req.body);
    await connection.commit();
    const user = { id: userResult.insertId, full_name: req.body.fullName, email: req.body.email, role: 'ngo' };
    return res.status(201).json({
      success: true,
      message: 'NGO registration successful. Your account is active.',
      token: tokenFor(user),
      user: { id: user.id, name: user.full_name, role: user.role }
    });
  } catch (error) { await connection.rollback(); next(error); } finally { connection.release(); }
};

exports.loginNGO = async (req, res, next) => {
  try {
    const user = await User.findByEmail(req.body.email);
    if (!user || user.role !== 'ngo' || !(await bcrypt.compare(req.body.password, user.password))) return res.status(401).json({ success: false, message: 'Invalid NGO email or password.' });
    const ngo = await NGO.findByUserId(user.id);
    if (!ngo || ['rejected', 'suspended'].includes(ngo.account_status)) return res.status(403).json({ success: false, message: 'Your NGO account is not active.' });
    return res.json({ success: true, message: 'Login successful.', token: tokenFor(user), user: { id: user.id, name: user.full_name, role: user.role } });
  } catch (error) { next(error); }
};

exports.getProfile = async (req, res, next) => { try { return res.json({ success: true, profile: await NGO.findByUserId(req.user.id) }); } catch (error) { next(error); } };
exports.updateLocation = async (req, res, next) => {
  const latitude = Number(req.body.latitude);
  const longitude = Number(req.body.longitude);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    return res.status(422).json({ success: false, message: 'Provide valid latitude and longitude coordinates.' });
  }
  try {
    await pool.execute('UPDATE users SET latitude = ?, longitude = ? WHERE id = ? AND role = \'ngo\'', [latitude, longitude, req.user.id]);
    return res.json({ success: true, message: 'NGO location updated for nearby matching.', location: { latitude, longitude } });
  } catch (error) { next(error); }
};
exports.updateProfile = async (req, res, next) => {
  const connection = await pool.getConnection();
  try {
    const ngo = await NGO.findByUserId(req.user.id);
    if (!ngo) return res.status(404).json({ success: false, message: 'NGO profile not found.' });
    await connection.beginTransaction();
    await connection.execute('UPDATE users SET full_name = ?, mobile = ?, address = ?, city = ?, state = ?, pincode = ?, latitude = COALESCE(?, latitude), longitude = COALESCE(?, longitude) WHERE id = ?', [req.body.fullName, req.body.mobile, req.body.address, req.body.city, req.body.state, req.body.pincode, req.body.latitude ?? null, req.body.longitude ?? null, req.user.id]);
    await NGO.update(connection, ngo.id, req.body);
    await connection.commit();
    return res.json({ success: true, message: 'NGO profile updated successfully.', profile: await NGO.findByUserId(req.user.id) });
  } catch (error) { await connection.rollback(); next(error); } finally { connection.release(); }
};

exports.browseDonations = async (req, res, next) => {
  try {
    const hasLatitude = req.query.latitude !== undefined;
    const hasLongitude = req.query.longitude !== undefined;
    if (hasLatitude !== hasLongitude) return res.status(422).json({ success: false, message: 'Provide both latitude and longitude for nearby food discovery.' });
    // Location improves ranking only. Older databases can be missing one of
    // the additive coordinate columns, so a profile lookup must never take
    // the available-food feed down with it.
    let ngo = null;
    try {
      const [ngoRows] = await pool.execute('SELECT city, pincode, latitude, longitude FROM users WHERE id = ? AND role = \'ngo\' LIMIT 1', [req.user.id]);
      ngo = ngoRows[0] || null;
    } catch (error) {
      console.warn('[NGO feed] Could not read saved location; returning food without location ranking.', error.code || 'LOCATION_LOOKUP_FAILED');
      try {
        const [ngoRows] = await pool.execute('SELECT city, pincode FROM users WHERE id = ? AND role = \'ngo\' LIMIT 1', [req.user.id]);
        ngo = ngoRows[0] || null;
      } catch (fallbackError) {
        console.warn('[NGO feed] Could not read NGO locality; returning available food without location ranking.', fallbackError.code || 'LOCALITY_LOOKUP_FAILED');
      }
    }
    const candidateLat = ngo?.latitude !== null && ngo?.latitude !== undefined ? Number(ngo.latitude) : null;
    const candidateLon = ngo?.longitude !== null && ngo?.longitude !== undefined ? Number(ngo.longitude) : null;
    const hasSavedCoordinates = Number.isFinite(candidateLat) && Math.abs(candidateLat) <= 90
      && Number.isFinite(candidateLon) && Math.abs(candidateLon) <= 180;
    const savedLat = hasSavedCoordinates ? candidateLat : null;
    const savedLon = hasSavedCoordinates ? candidateLon : null;
    const userLat = hasLatitude ? Number(req.query.latitude) : savedLat;
    const userLon = hasLongitude ? Number(req.query.longitude) : savedLon;
    if (hasLatitude && (!Number.isFinite(userLat) || Math.abs(userLat) > 90 || !Number.isFinite(userLon) || Math.abs(userLon) > 180)) {
      return res.status(422).json({ success: false, message: 'Nearby food discovery needs valid latitude and longitude values.' });
    }
    const configuredRadius = Number(process.env.NGO_MATCH_RADIUS_KM) || 35;
    const requestedRadius = req.query.radiusKm === undefined ? configuredRadius : Number(req.query.radiusKm);
    if (!Number.isFinite(requestedRadius) || requestedRadius <= 0) return res.status(422).json({ success: false, message: 'The search radius must be a positive number of kilometres.' });
    const radiusKm = Math.min(requestedRadius, 250);

    let where = "WHERE d.status = 'available' AND d.expiry_time > NOW()";
    const values = [];

    // Keep location as a ranking signal rather than an eligibility filter.
    // Address-only and out-of-radius donations remain visible to NGOs.

    const donations = await Donation.list({ where, values, limit: req.query.limit || 50, offset: req.query.offset || 0 });
    let mapped = donations.map(d => {
      const enriched = enrichWithCountdown(d, userLat, userLon);
      const match = scoreDonationForNgo(enriched, { distanceKm: enriched.distance_km, radiusKm });
      const donationCity = normalizeCity(d.pickup_city || d.business_city);
      const ngoCity = normalizeCity(ngo?.city);
      const sameCity = Boolean(donationCity && ngoCity && donationCity === ngoCity);
      const donationPincode = String(d.pickup_pincode || '').replace(/\D/g, '');
      const ngoPincode = String(ngo?.pincode || '').replace(/\D/g, '');
      const samePincode = Boolean(donationPincode && ngoPincode && donationPincode === ngoPincode);
      const withinRadius = Number.isFinite(enriched.distance_km) && enriched.distance_km <= radiusKm;
      return { ...enriched, ...match, location_match: withinRadius || samePincode || sameCity, same_city: sameCity, same_pincode: samePincode };
    });

    // Emergency alerts lead; then urgency, match score, distance, and expiry.
    mapped.sort((a, b) => {
      if (Boolean(a.is_emergency) !== Boolean(b.is_emergency)) return a.is_emergency ? -1 : 1;
      const urgencyDiff = (urgencyRank[a.urgency] ?? 5) - (urgencyRank[b.urgency] ?? 5);
      if (urgencyDiff) return urgencyDiff;
      if (a.location_match !== b.location_match) return a.location_match ? -1 : 1;
      if (a.score !== b.score) return b.score - a.score;
      if (a.distance_km !== null && b.distance_km !== null) return a.distance_km - b.distance_km;
      return new Date(a.expiry_time) - new Date(b.expiry_time);
    });

    return res.json({ success: true, donations: mapped, locationRequired: userLat === null, locationMessage: userLat === null ? 'Add your location to prioritize nearby donations.' : null });
  } catch (error) { next(error); }
};

exports.recommendedDonations = async (req, res, next) => {
  const originalJson = res.json.bind(res);
  res.json = payload => originalJson({
    ...payload,
    donations: (payload.donations || []).filter(donation => donation.recommended)
  });
  return exports.browseDonations(req, res, next);
};

exports.acceptDonation = async (req, res, next) => {
  const connection = await pool.getConnection();
  try {
    const ngo = await NGO.findByUserId(req.user.id);
    if (!ngo || ngo.account_status !== 'active') return res.status(403).json({ success: false, message: 'Your NGO account is not active.' });
    await connection.beginTransaction();
    const accepted = await AcceptedDonation.accept(connection, req.params.id, ngo.id);
    if (!accepted) { await connection.rollback(); return res.status(409).json({ success: false, message: 'This donation is no longer available.' }); }
    
    // Fetch donation and donor info
    const [dRows] = await connection.execute('SELECT business_user_id, food_name, quantity FROM donations WHERE id = ?', [req.params.id]);
    const dInfo = dRows[0];

    // Notify donor
    if (dInfo) {
      await sendNotification({
        recipientUserId: dInfo.business_user_id,
        notificationType: 'donation_accepted',
        donationId: Number(req.params.id),
        title: '🤝 Donation Accepted by NGO!',
        message: `Your donation "${dInfo.food_name}" has been accepted by ${ngo.ngo_name || 'an NGO'}. The NGO will coordinate collection directly.`,
        connection
      });
    }

    await connection.commit();
    return res.json({ success: true, message: 'Donation accepted successfully. Schedule its pickup from your accepted donations.' });
  } catch (error) { await connection.rollback(); next(error); } finally { connection.release(); }
};

exports.history = async (req, res, next) => {
  try {
    const ngo = await NGO.findByUserId(req.user.id);
    const history = ngo ? await AcceptedDonation.history(ngo.id) : [];
    return res.json({ success: true, donations: history.map(d => enrichWithCountdown(d)) });
  } catch (error) { next(error); }
};

exports.confirmDelivery = async (req, res, next) => {
  return res.status(409).json({ success: false, message: 'Record pickup, food collection, and distribution before completing this donation.' });
};

const findNgoPickupForUpdate = async (connection, donationId, ngoId) => {
  const [rows] = await connection.execute(
    `SELECT pr.*, d.business_user_id, d.food_name, d.quantity, d.number_of_meals, d.expiry_time,
            d.status AS donation_status
     FROM pickup_requests pr JOIN donations d ON d.id = pr.donation_id
     WHERE pr.donation_id = ? AND pr.ngo_id = ? LIMIT 1 FOR UPDATE`,
    [donationId, ngoId]
  );
  return rows[0] || null;
};

const donorEvent = (pickup, title, message, connection, notificationType) => sendNotification({
  recipientUserId: pickup.business_user_id,
  notificationType,
  donationId: Number(pickup.donation_id),
  title,
  message,
  connection
});

exports.schedulePickup = async (req, res, next) => {
  const connection = await pool.getConnection();
  try {
    const date = String(req.body.pickupDate || '');
    const time = String(req.body.pickupTime || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
      return res.status(422).json({ success: false, message: 'Choose a valid pickup date and time.' });
    }
    const scheduledAt = new Date(`${date}T${time}:00`);
    if (!Number.isFinite(scheduledAt.getTime()) || scheduledAt <= new Date()) return res.status(422).json({ success: false, message: 'Pickup time must be in the future.' });
    await connection.beginTransaction();
    const ngo = await NGO.findByUserId(req.user.id);
    const pickup = ngo && await findNgoPickupForUpdate(connection, req.params.id, ngo.id);
    if (!pickup) { await connection.rollback(); return res.status(404).json({ success: false, message: 'Accepted donation was not found for this NGO.' }); }
    if (!['pending', 'pickup_scheduled'].includes(pickup.status)) { await connection.rollback(); return res.status(409).json({ success: false, message: 'Pickup can only be scheduled before it starts.' }); }
    if (scheduledAt >= new Date(pickup.expiry_time)) { await connection.rollback(); return res.status(422).json({ success: false, message: 'Pickup must be scheduled before the food expires.' }); }
    await connection.execute("UPDATE pickup_requests SET pickup_date = ?, pickup_time = ?, pickup_scheduled_at = NOW(), status = 'pickup_scheduled' WHERE id = ?", [date, time, pickup.id]);
    await connection.execute("UPDATE donations SET status = 'pickup_scheduled' WHERE id = ?", [pickup.donation_id]);
    await connection.execute("UPDATE accepted_donations SET status = 'pickup_scheduled' WHERE donation_id = ? AND ngo_id = ?", [pickup.donation_id, ngo.id]);
    await donorEvent(pickup, 'Pickup scheduled', `The NGO scheduled pickup for ${date} at ${time}.`, connection, 'pickup_scheduled');
    await connection.commit();
    return res.json({ success: true, message: 'Pickup scheduled.', pickup: { date, time, status: 'pickup_scheduled' } });
  } catch (error) { await connection.rollback(); next(error); } finally { connection.release(); }
};

exports.startPickup = async (req, res, next) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const ngo = await NGO.findByUserId(req.user.id);
    const pickup = ngo && await findNgoPickupForUpdate(connection, req.params.id, ngo.id);
    if (!pickup) { await connection.rollback(); return res.status(404).json({ success: false, message: 'Accepted donation was not found for this NGO.' }); }
    if (pickup.status !== 'pickup_scheduled') { await connection.rollback(); return res.status(409).json({ success: false, message: 'Schedule the pickup before starting it.' }); }
    await connection.execute("UPDATE pickup_requests SET status = 'pickup_started', pickup_started_at = NOW() WHERE id = ?", [pickup.id]);
    await connection.execute("UPDATE donations SET status = 'pickup_started' WHERE id = ?", [pickup.donation_id]);
    await connection.execute("UPDATE accepted_donations SET status = 'pickup_started' WHERE donation_id = ? AND ngo_id = ?", [pickup.donation_id, ngo.id]);
    await donorEvent(pickup, 'Pickup started', 'The NGO has started traveling to collect your food donation.', connection, 'pickup_started');
    await connection.commit();
    return res.json({ success: true, message: 'Pickup started.', status: 'pickup_started' });
  } catch (error) { await connection.rollback(); next(error); } finally { connection.release(); }
};

exports.collectFood = async (req, res, next) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const ngo = await NGO.findByUserId(req.user.id);
    const pickup = ngo && await findNgoPickupForUpdate(connection, req.params.id, ngo.id);
    if (!pickup) { await connection.rollback(); return res.status(404).json({ success: false, message: 'Accepted donation was not found for this NGO.' }); }
    if (pickup.status !== 'pickup_started') { await connection.rollback(); return res.status(409).json({ success: false, message: 'Food can only be marked collected after pickup starts.' }); }
    await connection.execute("UPDATE pickup_requests SET status = 'food_collected', food_collected_at = NOW() WHERE id = ?", [pickup.id]);
    await connection.execute("UPDATE donations SET status = 'food_collected' WHERE id = ?", [pickup.donation_id]);
    await connection.execute("UPDATE accepted_donations SET status = 'food_collected' WHERE donation_id = ? AND ngo_id = ?", [pickup.donation_id, ngo.id]);
    await donorEvent(pickup, 'Food collected', 'The NGO confirmed collection of your food donation.', connection, 'food_collected');
    await connection.commit();
    return res.json({ success: true, message: 'Food collection confirmed.', status: 'food_collected' });
  } catch (error) { await connection.rollback(); next(error); } finally { connection.release(); }
};

exports.recordDistribution = async (req, res, next) => {
  const connection = await pool.getConnection();
  try {
    const peopleServed = Number(req.body.peopleServed);
    const location = String(req.body.distributionLocation || '').trim();
    const notes = String(req.body.distributionNotes || '').trim();
    const distributedAt = new Date(req.body.distributionDateTime);
    if (!req.file) return res.status(422).json({ success: false, message: 'Upload a distribution proof photo.' });
    if (!Number.isInteger(peopleServed) || peopleServed < 1 || peopleServed > 1000000) return res.status(422).json({ success: false, message: 'Enter the actual number of people served.' });
    if (!location || location.length > 255) return res.status(422).json({ success: false, message: 'Enter a distribution location no longer than 255 characters.' });
    if (!Number.isFinite(distributedAt.getTime()) || distributedAt > new Date()) return res.status(422).json({ success: false, message: 'Enter a valid distribution date and time.' });
    if (notes.length > 1000) return res.status(422).json({ success: false, message: 'Distribution notes must be 1000 characters or fewer.' });
    await connection.beginTransaction();
    const ngo = await NGO.findByUserId(req.user.id);
    const pickup = ngo && await findNgoPickupForUpdate(connection, req.params.id, ngo.id);
    if (!pickup) { await connection.rollback(); return res.status(404).json({ success: false, message: 'Accepted donation was not found for this NGO.' }); }
    if (pickup.status !== 'food_collected') { await connection.rollback(); return res.status(409).json({ success: false, message: 'Distribution can only be recorded after food is collected.' }); }
    const proofPath = `/${path.relative(path.join(__dirname, '..'), req.file.path).split(path.sep).join('/')}`;
    await DeliveryProof.upsert(connection, pickup.id, proofPath, notes);
    await connection.execute(
      "UPDATE pickup_requests SET status = 'delivered', distribution_started_at = ?, distribution_completed_at = ?, people_served = ?, distribution_location = ?, distribution_notes = ? WHERE id = ?",
      [distributedAt, distributedAt, peopleServed, location, notes || null, pickup.id]
    );
    await connection.execute("UPDATE donations SET status = 'delivered' WHERE id = ?", [pickup.donation_id]);
    await connection.execute("UPDATE accepted_donations SET status = 'delivered' WHERE donation_id = ? AND ngo_id = ?", [pickup.donation_id, ngo.id]);
    await donorEvent(pickup, 'Distribution recorded', `The NGO recorded distribution to ${peopleServed} people at ${location}.`, connection, 'distribution_recorded');
    await connection.commit();
    return res.json({ success: true, message: 'Distribution recorded with proof.', status: 'delivered' });
  } catch (error) { await connection.rollback(); next(error); } finally { connection.release(); }
};

exports.completeRescue = async (req, res, next) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const ngo = await NGO.findByUserId(req.user.id);
    const pickup = ngo && await findNgoPickupForUpdate(connection, req.params.id, ngo.id);
    if (!pickup) { await connection.rollback(); return res.status(404).json({ success: false, message: 'Accepted donation was not found for this NGO.' }); }
    if (pickup.status !== 'delivered' || !pickup.people_served || !await DeliveryProof.exists(pickup.id, connection)) {
      await connection.rollback();
      return res.status(409).json({ success: false, message: 'Record distribution details and proof before completing the rescue.' });
    }
    await connection.execute("UPDATE pickup_requests SET status = 'completed' WHERE id = ? AND status = 'delivered'", [pickup.id]);
    await connection.execute("UPDATE donations SET status = 'completed' WHERE id = ? AND status = 'delivered'", [pickup.donation_id]);
    await connection.execute("UPDATE accepted_donations SET status = 'completed' WHERE donation_id = ? AND ngo_id = ? AND status = 'delivered'", [pickup.donation_id, ngo.id]);
    await awardPoints(req.user.id, 100, connection);
    await awardPoints(pickup.business_user_id, 50, connection);
    await donorEvent(pickup, 'Food rescue completed', `The donation was distributed to ${pickup.people_served} people. Your donation certificate is now available.`, connection, 'donation_completed');
    await connection.commit();
    return res.json({ success: true, message: 'Rescue completed. Impact points recorded.' });
  } catch (error) { await connection.rollback(); next(error); } finally { connection.release(); }
};
