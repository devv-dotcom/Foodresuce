const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('../config/database');
const User = require('../models/User');
const NGO = require('../models/NGO');
const Donation = require('../models/Donation');
const AcceptedDonation = require('../models/AcceptedDonation');
const { sendNotification, awardPoints } = require('../utils/notify');

const tokenFor = user => jwt.sign({ sub: user.id, role: 'ngo' }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });

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
  if (userLat !== null && userLon !== null && d.latitude !== null && d.longitude !== null) {
    const R = 6371;
    const dLat = (d.latitude - userLat) * Math.PI / 180;
    const dLon = (d.longitude - userLon) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(userLat * Math.PI / 180) * Math.cos(d.latitude * Math.PI / 180) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    distanceKm = Number((R * c).toFixed(1));
  }
  
  return {
    ...d,
    distance_km: distanceKm,
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
    return res.status(201).json({ success: true, message: 'NGO registration received. An administrator must approve it before sign-in.', user: { id: user.id, name: user.full_name, role: user.role } });
  } catch (error) { await connection.rollback(); next(error); } finally { connection.release(); }
};

exports.loginNGO = async (req, res, next) => {
  try {
    const user = await User.findByEmail(req.body.email);
    if (!user || user.role !== 'ngo' || !(await bcrypt.compare(req.body.password, user.password))) return res.status(401).json({ success: false, message: 'Invalid NGO email or password.' });
    const ngo = await NGO.findByUserId(user.id);
    if (!ngo || ngo.account_status !== 'active') return res.status(403).json({ success: false, message: ngo?.account_status === 'pending' ? 'Your NGO application is awaiting administrator approval.' : 'Your NGO account is not active.' });
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
    const userLat = hasLatitude ? Number(req.query.latitude) : null;
    const userLon = hasLongitude ? Number(req.query.longitude) : null;
    if (hasLatitude && (!Number.isFinite(userLat) || Math.abs(userLat) > 90 || !Number.isFinite(userLon) || Math.abs(userLon) > 180)) {
      return res.status(422).json({ success: false, message: 'Nearby food discovery needs valid latitude and longitude values.' });
    }
    const configuredRadius = Number(process.env.NGO_MATCH_RADIUS_KM) || 35;
    const requestedRadius = req.query.radiusKm === undefined ? configuredRadius : Number(req.query.radiusKm);
    if (!Number.isFinite(requestedRadius) || requestedRadius <= 0) return res.status(422).json({ success: false, message: 'The search radius must be a positive number of kilometres.' });
    const radiusKm = Math.min(requestedRadius, 250);

    let where = "WHERE d.status = 'available' AND d.expiry_time > NOW()";
    const values = [];

    if (userLat !== null && userLon !== null) {
      where += ' AND d.latitude IS NOT NULL AND d.longitude IS NOT NULL AND (6371 * ACOS(LEAST(1.0, GREATEST(-1.0, COS(RADIANS(?)) * COS(RADIANS(d.latitude)) * COS(RADIANS(d.longitude) - RADIANS(?)) + SIN(RADIANS(?)) * SIN(RADIANS(d.latitude)))))) <= ?';
      values.push(userLat, userLon, userLat, radiusKm);
    } else {
      const ngo = await NGO.findByUserId(req.user.id);
      if (!ngo?.city) return res.json({ success: true, donations: [], locationRequired: true });
      where += ' AND LOWER(COALESCE(d.pickup_city, u.city)) = LOWER(?)';
      values.push(ngo.city.trim());
    }

    const donations = await Donation.list({ where, values, limit: req.query.limit || 50, offset: req.query.offset || 0 });
    let mapped = donations.map(d => enrichWithCountdown(d, userLat, userLon));

    // Sort: urgent first, then distance or date
    mapped.sort((a, b) => {
      if (a.is_urgent && !b.is_urgent) return -1;
      if (!a.is_urgent && b.is_urgent) return 1;
      if (a.distance_km !== null && b.distance_km !== null) return a.distance_km - b.distance_km;
      return new Date(a.expiry_time) - new Date(b.expiry_time);
    });

    return res.json({ success: true, donations: mapped, locationRequired: userLat === null });
  } catch (error) { next(error); }
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

    // Award 50 points to NGO for accepting
    await awardPoints(req.user.id, 50, connection);

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
    return res.json({ success: true, message: 'Donation accepted successfully! Points awarded.' });
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
  const connection = await pool.getConnection();
  try {
    const ngo = await NGO.findByUserId(req.user.id);
    if (!ngo) return res.status(404).json({ success: false, message: 'NGO not found.' });
    await connection.beginTransaction();
    const [result] = await connection.execute(
      `UPDATE donations d
       JOIN accepted_donations ad ON ad.donation_id = d.id
       SET d.status = 'completed', ad.status = 'completed'
       WHERE d.id = ? AND ad.ngo_id = ? AND d.status IN ('delivered', 'picked_up', 'accepted')`,
      [req.params.id, ngo.id]
    );
    if (result.affectedRows === 0) {
      await connection.rollback();
      return res.status(400).json({ success: false, message: 'Donation delivery cannot be confirmed at this stage or does not belong to your NGO.' });
    }
    const [donationRows] = await connection.execute(
      'SELECT business_user_id, food_name, number_of_meals FROM donations WHERE id = ?',
      [req.params.id]
    );
    const donation = donationRows[0];

    // Award completion points:
    // NGO: 100 points
    await awardPoints(req.user.id, 100, connection);
    if (donation) {
      // Donor: 50 completion bonus points
      await awardPoints(donation.business_user_id, 50, connection);

      // Notify donor
      await sendNotification({
        recipientUserId: donation.business_user_id,
        notificationType: 'donation_completed',
        donationId: Number(req.params.id),
        title: '🎉 Rescue Completed & Certificate Ready!',
        message: `Your donation "${donation.food_name}" was safely distributed to beneficiaries! You earned 50 impact points and your digital certificate is ready in your dashboard.`,
        connection
      });
    }

    await connection.commit();
    return res.json({ success: true, message: 'Delivery confirmed successfully! Donation marked as completed and impact points credited.' });
  } catch (error) { await connection.rollback(); next(error); } finally { connection.release(); }
};
