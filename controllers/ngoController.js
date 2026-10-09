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
  if (userLat && userLon && d.latitude && d.longitude) {
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
      `INSERT INTO users (full_name, email, mobile, password, role, address, city, state, pincode)
       VALUES (?, ?, ?, ?, 'ngo', ?, ?, ?, ?)`,
      [req.body.fullName, req.body.email.toLowerCase(), req.body.mobile, password, req.body.address, req.body.city, req.body.state, req.body.pincode]
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
exports.updateProfile = async (req, res, next) => {
  const connection = await pool.getConnection();
  try {
    const ngo = await NGO.findByUserId(req.user.id);
    if (!ngo) return res.status(404).json({ success: false, message: 'NGO profile not found.' });
    await connection.beginTransaction();
    await connection.execute('UPDATE users SET full_name = ?, mobile = ?, address = ?, city = ?, state = ?, pincode = ? WHERE id = ?', [req.body.fullName, req.body.mobile, req.body.address, req.body.city, req.body.state, req.body.pincode, req.user.id]);
    await NGO.update(connection, ngo.id, req.body);
    await connection.commit();
    return res.json({ success: true, message: 'NGO profile updated successfully.', profile: await NGO.findByUserId(req.user.id) });
  } catch (error) { await connection.rollback(); next(error); } finally { connection.release(); }
};

exports.browseDonations = async (req, res, next) => {
  try {
    const userLat = Number(req.query.latitude) || null;
    const userLon = Number(req.query.longitude) || null;
    const radiusKm = Number(req.query.radiusKm) || 50;

    let where = "WHERE d.status = 'available' AND d.expiry_time > NOW()";
    const values = [];

    if (userLat && userLon) {
      // Keep listings without donor GPS visible. Address/city-only donations
      // are valid and should not disappear when an NGO shares its location.
      where += ' AND (d.latitude IS NULL OR d.longitude IS NULL OR (6371 * ACOS(COS(RADIANS(?)) * COS(RADIANS(d.latitude)) * COS(RADIANS(d.longitude) - RADIANS(?)) + SIN(RADIANS(?)) * SIN(RADIANS(d.latitude)))) <= ?)';
      values.push(userLat, userLon, userLat, radiusKm);
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

    return res.json({ success: true, donations: mapped });
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
        title: '🎉 Rescue Completed & Certificate Ready!',
        message: `Your donation "${donation.food_name}" was safely distributed to beneficiaries! You earned 50 impact points and your digital certificate is ready in your dashboard.`,
        connection
      });
    }

    await connection.commit();
    return res.json({ success: true, message: 'Delivery confirmed successfully! Donation marked as completed and impact points credited.' });
  } catch (error) { await connection.rollback(); next(error); } finally { connection.release(); }
};
