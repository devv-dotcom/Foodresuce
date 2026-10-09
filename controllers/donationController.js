const path = require('path');
const pool = require('../config/database');
const Donation = require('../models/Donation');
const DonationImage = require('../models/DonationImage');
const { sendNotification, awardPoints } = require('../utils/notify');
const { safetyDeclarationComplete, donationWindowError } = require('../utils/donationSafety');

const imagePaths = files => (files || []).map(file => `/${path.relative(path.join(__dirname, '..'), file.path).split(path.sep).join('/')}`);
const pagination = query => ({ limit: Math.min(Math.max(Number(query.limit) || 20, 1), 100), offset: Math.max(Number(query.offset) || 0, 0) });

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

    // Automated broadcast notification to NGOs
    const isUrgent = (new Date(req.body.expiryTime).getTime() - Date.now()) <= 2.5 * 3600000;
    await sendNotification({
      targetRole: 'ngo',
      title: isUrgent ? '🚨 URGENT: Food Donation Needs Rescue' : '🍲 New Food Donation Available',
      message: `${req.body.foodName} (${req.body.quantity}) listed at ${req.body.pickupAddress || 'your area'}.`,
      connection
    });

    const createdDonation = enrichWithCountdown(await Donation.findById(donationId));
    await connection.commit();
    return res.status(201).json({ success: true, message: 'Donation published. Donor food-handling declarations were recorded.', donation: createdDonation });
  } catch (error) {
    if (connection) {
      try { await connection.rollback(); } catch (_) {}
    }
    next(error);
  } finally { connection?.release(); }
};

exports.getDonation = async (req, res, next) => {
  try {
    const donation = await Donation.findById(req.params.id);
    if (!donation) return res.status(404).json({ success: false, message: 'Donation not found.' });
    if (req.user.role !== 'admin' && req.user.role !== 'ngo' && donation.business_user_id !== req.user.id) {
      return res.status(403).json({ success: false, message: 'You do not have access to this donation.' });
    }
    donation.images = await Donation.getImages(donation.id);
    return res.json({ success: true, donation: enrichWithCountdown(donation) });
  } catch (error) { next(error); }
};

exports.getAllDonations = async (req, res, next) => {
  try {
    const list = await Donation.list(pagination(req.query));
    return res.json({ success: true, donations: list.map(enrichWithCountdown) });
  } catch (error) { next(error); }
};

exports.searchDonation = async (req, res, next) => {
  try {
    const term = `%${(req.query.q || '').trim()}%`;
    if (term === '%%') return res.status(422).json({ success: false, message: 'Provide a search term.' });
    const where = 'WHERE d.food_name LIKE ? OR c.name LIKE ? OR u.city LIKE ? OR u.business_name LIKE ? OR d.status LIKE ?';
    const list = await Donation.list({ where, values: [term, term, term, term, term], ...pagination(req.query) });
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
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const list = await Donation.list({ where, values, ...pagination(req.query) });
    return res.json({ success: true, donations: list.map(enrichWithCountdown) });
  } catch (error) { next(error); }
};

exports.getEmergencyDonations = async (_req, res, next) => {
  try {
    const [rows] = await pool.execute(`
      SELECT d.*, c.name AS category_name, u.business_name, u.full_name AS owner_name, u.city AS business_city,
        (SELECT image_path FROM donation_images WHERE donation_id = d.id ORDER BY id ASC LIMIT 1) AS food_image
      FROM donations d
      JOIN food_categories c ON c.id = d.category_id
      JOIN users u ON u.id = d.business_user_id
      WHERE d.status = 'available' AND d.deleted_at IS NULL AND (d.is_emergency = TRUE OR d.expiry_time <= DATE_ADD(NOW(), INTERVAL 2 HOUR))
      ORDER BY d.expiry_time ASC
      LIMIT 20
    `);
    return res.json({ success: true, donations: rows.map(enrichWithCountdown) });
  } catch (error) { next(error); }
};

exports.emergencyBroadcast = async (req, res, next) => {
  try {
    const donation = await Donation.findById(req.params.id);
    if (!donation) return res.status(404).json({ success: false, message: 'Donation not found.' });
    if (donation.business_user_id !== req.user.id) return res.status(403).json({ success: false, message: 'You can only broadcast an emergency for your own donation.' });
    if (donation.status !== 'available' || new Date(donation.expiry_time) <= new Date()) return res.status(409).json({ success: false, message: 'Only available, unexpired donations can be broadcast as emergencies.' });

    await pool.execute('UPDATE donations SET is_emergency = TRUE WHERE id = ?', [donation.id]);

    await sendNotification({
      targetRole: 'ngo',
      title: '🚨 EMERGENCY RESCUE BROADCAST',
      message: `URGENT RESCUE: ${donation.food_name} (${donation.quantity}) needs immediate acceptance!`
    });

    return res.json({ success: true, message: 'Emergency alert broadcasted to verified NGOs.' });
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
