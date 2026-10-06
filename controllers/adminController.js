const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const pool = require('../config/database');
const Admin = require('../models/Admin');
const User = require('../models/User');
const ActivityLog = require('../models/ActivityLog');
const Donation = require('../models/Donation');
const { sendLoginOtp } = require('../utils/mail');

const tokenFor = admin => jwt.sign({ sub: admin.id, role: 'admin' }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });
const page = query => ({ limit: Math.min(Math.max(Number(query.limit) || 20, 1), 100), offset: Math.max(Number(query.offset) || 0, 0) });
const log = (req, action, entityType, entityId, details) => ActivityLog.create({ actorUserId: req.user.id, action, entityType, entityId, details, ipAddress: req.ip });
const otpHash = otp => crypto.createHash('sha256').update(otp).digest('hex');

exports.login = async (req, res, next) => {
  try {
    const admin = await Admin.findByEmail(req.body.email);
    if (!admin || admin.account_status !== 'active' || !(await bcrypt.compare(req.body.password, admin.password))) return res.status(401).json({ success: false, message: 'Invalid administrator email or password.' });
    const otp = crypto.randomInt(100000, 1000000).toString();
    await User.saveLoginOtp(admin.email, otpHash(otp), new Date(Date.now() + Number(process.env.LOGIN_OTP_TTL_MS || 10 * 60 * 1000)));
    try {
      await sendLoginOtp({ email: admin.email, fullName: admin.full_name, otp });
    } catch (mailError) {
      await User.clearLoginOtp(admin.id);
      console.error('Administrator OTP delivery failed.', { code: mailError.code || 'MAIL_DELIVERY_FAILED' });
      return res.status(503).json({ success: false, message: 'We could not deliver a sign-in code. Please try again later.' });
    }
    return res.json({
      success: true,
      requiresOtp: true,
      email: admin.email,
      message: 'We sent a 6-digit administrator sign-in code to your email.'
    });
  } catch (error) { next(error); }
};

exports.listBusinesses = async (req, res, next) => { try { return res.json({ success: true, businesses: await Admin.listBusinesses({ q: req.query.q?.trim(), category: req.query.category, ...page(req.query) }) }); } catch (error) { next(error); } };
exports.listNgos = async (req, res, next) => { try { return res.json({ success: true, ngos: await Admin.listNgos({ q: req.query.q?.trim(), ...page(req.query) }) }); } catch (error) { next(error); } };

const changeAccount = (kind, status, message) => async (req, res, next) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [result] = await Admin.setAccountStatus(connection, kind, req.params.id, status);
    if (!result.affectedRows) { await connection.rollback(); return res.status(404).json({ success: false, message: `${kind[0].toUpperCase() + kind.slice(1)} not found.` }); }
    await connection.commit();
    await log(req, `${kind}_${status}`, kind, Number(req.params.id));
    return res.json({ success: true, message });
  } catch (error) { await connection.rollback(); next(error); } finally { connection.release(); }
};
exports.approveBusiness = changeAccount('business', 'active', 'Business Approved Successfully');
exports.rejectBusiness = changeAccount('business', 'rejected', 'Business Rejected Successfully');
exports.suspendBusiness = changeAccount('business', 'suspended', 'Business Suspended Successfully');
exports.activateBusiness = changeAccount('business', 'active', 'Business Activated Successfully');
exports.approveNgo = changeAccount('ngo', 'active', 'NGO Approved Successfully');
exports.rejectNgo = changeAccount('ngo', 'rejected', 'NGO Rejected Successfully');
exports.suspendNgo = changeAccount('ngo', 'suspended', 'NGO Suspended Successfully');

const deleteAccount = kind => async (req, res, next) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [result] = await Admin.deleteUser(connection, kind, req.params.id);
    if (!result.affectedRows) { await connection.rollback(); return res.status(404).json({ success: false, message: `${kind[0].toUpperCase() + kind.slice(1)} not found.` }); }
    await connection.commit();
    await log(req, `${kind}_deleted`, kind, Number(req.params.id));
    return res.json({ success: true, message: `${kind[0].toUpperCase() + kind.slice(1)} deleted successfully.` });
  } catch (error) { await connection.rollback(); next(error); } finally { connection.release(); }
};
exports.deleteBusiness = deleteAccount('business');
exports.deleteNgo = deleteAccount('ngo');

exports.listDonations = async (req, res, next) => {
  try {
    const clauses = []; const values = [];
    if (req.query.status) { clauses.push('d.status = ?'); values.push(req.query.status); }
    if (req.query.categoryId) { clauses.push('d.category_id = ?'); values.push(Number(req.query.categoryId)); }
    if (req.query.q?.trim()) { const q = `%${req.query.q.trim()}%`; clauses.push('(d.food_name LIKE ? OR u.business_name LIKE ? OR u.city LIKE ?)'); values.push(q, q, q); }
    if (req.query.includeDeleted !== 'true') clauses.push('d.deleted_at IS NULL');
    const includeDeleted = req.query.includeDeleted === 'true';
    const donations = await Donation.list({ where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', values, includeDeleted, ...page(req.query) });
    return res.json({ success: true, donations });
  } catch (error) { next(error); }
};

exports.updateDonationStatus = async (req, res, next) => {
  try {
    const [result] = await pool.execute('UPDATE donations SET status = ? WHERE id = ? AND deleted_at IS NULL', [req.body.status, req.params.id]);
    if (!result.affectedRows) return res.status(404).json({ success: false, message: 'Donation not found.' });
    await log(req, 'donation_status_updated', 'donation', Number(req.params.id), { status: req.body.status });
    return res.json({ success: true, message: 'Donation status updated successfully.' });
  } catch (error) { next(error); }
};
exports.deleteDonation = async (req, res, next) => {
  try {
    const [result] = await pool.execute("UPDATE donations SET deleted_at = CURRENT_TIMESTAMP, status = 'cancelled' WHERE id = ? AND deleted_at IS NULL", [req.params.id]);
    if (!result.affectedRows) return res.status(404).json({ success: false, message: 'Donation not found or already deleted.' });
    await log(req, 'donation_deleted', 'donation', Number(req.params.id));
    return res.json({ success: true, message: 'Donation deleted successfully.' });
  } catch (error) { next(error); }
};
exports.restoreDonation = async (req, res, next) => {
  try {
    const [result] = await pool.execute("UPDATE donations SET deleted_at = NULL, status = 'available' WHERE id = ? AND deleted_at IS NOT NULL", [req.params.id]);
    if (!result.affectedRows) return res.status(404).json({ success: false, message: 'Deleted donation not found.' });
    await log(req, 'donation_restored', 'donation', Number(req.params.id));
    return res.json({ success: true, message: 'Donation restored successfully.' });
  } catch (error) { next(error); }
};

exports.listActivityLogs = async (req, res, next) => { try { return res.json({ success: true, logs: await ActivityLog.list(...Object.values(page(req.query))) }); } catch (error) { next(error); } };

exports.listContactMessages = async (req, res, next) => {
  try {
    const { limit, offset } = page(req.query);
    const [messages] = await pool.execute('SELECT c.*, u.full_name AS replied_by_name FROM contact_messages c LEFT JOIN admins a ON a.id = c.replied_by LEFT JOIN users u ON u.id = a.user_id ORDER BY c.created_at DESC LIMIT ? OFFSET ?', [limit, offset]);
    return res.json({ success: true, messages });
  } catch (error) { next(error); }
};
exports.markContactRead = async (req, res, next) => {
  try {
    const [result] = await pool.execute("UPDATE contact_messages SET status = 'read' WHERE id = ? AND status = 'unread'", [req.params.id]);
    if (!result.affectedRows) return res.status(404).json({ success: false, message: 'Unread contact message not found.' });
    await log(req, 'contact_message_read', 'contact_message', Number(req.params.id));
    return res.json({ success: true, message: 'Contact message marked as read.' });
  } catch (error) { next(error); }
};
exports.replyToContact = async (req, res, next) => {
  try {
    const [result] = await pool.execute("UPDATE contact_messages SET status = 'replied', replied_by = ?, reply_message = ?, replied_at = CURRENT_TIMESTAMP WHERE id = ?", [req.admin.admin_id, req.body.replyMessage, req.params.id]);
    if (!result.affectedRows) return res.status(404).json({ success: false, message: 'Contact message not found.' });
    await log(req, 'contact_message_replied', 'contact_message', Number(req.params.id));
    return res.json({ success: true, message: 'Contact message reply saved successfully.' });
  } catch (error) { next(error); }
};
exports.deleteContactMessage = async (req, res, next) => {
  try {
    const [result] = await pool.execute('DELETE FROM contact_messages WHERE id = ?', [req.params.id]);
    if (!result.affectedRows) return res.status(404).json({ success: false, message: 'Contact message not found.' });
    await log(req, 'contact_message_deleted', 'contact_message', Number(req.params.id));
    return res.json({ success: true, message: 'Contact message deleted successfully.' });
  } catch (error) { next(error); }
};
exports.listReviews = async (req, res, next) => {
  try {
    const { limit, offset } = page(req.query);
    const [reviews] = await pool.execute('SELECT r.*, reviewer.full_name AS reviewer_name, reviewee.full_name AS reviewee_name FROM reviews r LEFT JOIN users reviewer ON reviewer.id = r.reviewer_user_id LEFT JOIN users reviewee ON reviewee.id = r.reviewee_user_id ORDER BY r.created_at DESC LIMIT ? OFFSET ?', [limit, offset]);
    return res.json({ success: true, reviews });
  } catch (error) { next(error); }
};
const moderateReview = (status, message) => async (req, res, next) => {
  try {
    const [result] = await pool.execute('UPDATE reviews SET status = ? WHERE id = ?', [status, req.params.id]);
    if (!result.affectedRows) return res.status(404).json({ success: false, message: 'Review not found.' });
    await log(req, `review_${status}`, 'review', Number(req.params.id));
    return res.json({ success: true, message });
  } catch (error) { next(error); }
};
exports.approveReview = moderateReview('approved', 'Review approved successfully.');
exports.hideReview = moderateReview('hidden', 'Review hidden successfully.');
exports.deleteReview = async (req, res, next) => {
  try {
    const [result] = await pool.execute('DELETE FROM reviews WHERE id = ?', [req.params.id]);
    if (!result.affectedRows) return res.status(404).json({ success: false, message: 'Review not found.' });
    await log(req, 'review_deleted', 'review', Number(req.params.id));
    return res.json({ success: true, message: 'Review deleted successfully.' });
  } catch (error) { next(error); }
};
exports.getSettings = async (_req, res, next) => {
  try { const [settings] = await pool.execute('SELECT setting_key, setting_value, updated_at FROM website_settings ORDER BY setting_key'); return res.json({ success: true, settings }); } catch (error) { next(error); }
};
exports.updateSetting = async (req, res, next) => {
  try {
    await pool.execute('INSERT INTO website_settings (setting_key, setting_value, updated_by) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_by = VALUES(updated_by)', [req.body.key, JSON.stringify(req.body.value), req.admin.admin_id]);
    await log(req, 'website_setting_updated', 'website_setting', null, { key: req.body.key });
    return res.json({ success: true, message: 'Website setting updated successfully.' });
  } catch (error) { next(error); }
};
