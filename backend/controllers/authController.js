const bcrypt = require('bcrypt');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const pool = require('../config/database');
const User = require('../models/User');
const { sendPasswordOtp } = require('../utils/mail');

const signAccessToken = user => jwt.sign({ sub: user.id, role: user.role }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });
const serializeUser = user => ({ id: user.id, name: user.full_name, email: user.email, role: user.role, city: user.city, profileImage: user.profile_image });
const otpHash = otp => crypto.createHash('sha256').update(otp).digest('hex');

const BUSINESS_ROLES = ['restaurant', 'hotel', 'bakery', 'supermarket', 'catering', 'marriage_hall'];

exports.register = async (req, res, next) => {
  const connection = await pool.getConnection();
  try {
    const existing = await User.findByEmail(req.body.email);
    if (existing) return res.status(409).json({ success: false, message: 'An account with this email already exists.' });
    
    await connection.beginTransaction();
    const password = await bcrypt.hash(req.body.password, 12);
    const role = (req.body.role || 'restaurant').toLowerCase();
    
    const [userResult] = await connection.execute(
      `INSERT INTO users
        (full_name, email, mobile, password, role, business_name, address, city, state, pincode)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        req.body.fullName,
        req.body.email.toLowerCase(),
        req.body.mobile || '',
        password,
        role,
        req.body.businessName || req.body.fullName,
        req.body.address || '',
        req.body.city || '',
        req.body.state || '',
        req.body.pincode || ''
      ]
    );

    const userId = userResult.insertId;

    if (BUSINESS_ROLES.includes(role)) {
      await connection.execute(
        `INSERT INTO business_profiles (user_id, business_name, business_type, account_status)
         VALUES (?, ?, ?, 'active')
         ON DUPLICATE KEY UPDATE business_name = VALUES(business_name), business_type = VALUES(business_type)`,
        [userId, req.body.businessName || req.body.fullName, role]
      );
    }

    await connection.commit();
    const user = await User.findPublicById(userId);
    const token = signAccessToken(user);

    return res.status(201).json({ success: true, message: 'Registration successful. Your account is active.', token, user: serializeUser(user) });
  } catch (error) {
    await connection.rollback();
    next(error);
  } finally {
    connection.release();
  }
};

exports.login = async (req, res, next) => {
  try {
    const user = await User.findByEmail(req.body.email);
    const valid = user && await bcrypt.compare(req.body.password, user.password);
    if (!valid) return res.status(401).json({ success: false, message: 'Invalid email or password.' });

    if (BUSINESS_ROLES.includes(user.role)) {
      const [rows] = await pool.execute('SELECT account_status FROM business_profiles WHERE user_id = ? LIMIT 1', [user.id]);
      const status = rows[0]?.account_status || 'active';
      if (status === 'rejected') return res.status(403).json({ success: false, message: 'Your business account application was rejected.' });
      if (status === 'suspended') return res.status(403).json({ success: false, message: 'Your business account has been suspended.' });
    }

    const publicUser = await User.findPublicById(user.id);
    return res.json({ success: true, message: 'Login successful.', token: signAccessToken(publicUser), user: serializeUser(publicUser) });
  } catch (error) { next(error); }
};

exports.logout = async (_req, res) => res.json({ success: true, message: 'Logged out successfully. Remove the JWT from the client.' });

exports.forgotPassword = async (req, res, next) => {
  try {
    const user = await User.findByEmail(req.body.email);
    // Keep response uniform so attackers cannot enumerate registered emails.
    if (!user) return res.json({ success: true, message: 'If that email is registered, a reset code has been sent.' });
    const otp = crypto.randomInt(100000, 1000000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    await User.saveOtp(user.email, otpHash(otp), expiresAt);
    await sendPasswordOtp({ email: user.email, fullName: user.full_name, otp });
    return res.json({ success: true, message: 'If that email is registered, a reset code has been sent.' });
  } catch (error) { next(error); }
};

exports.verifyOtp = async (req, res, next) => {
  try {
    const user = await User.findByEmail(req.body.email);
    const expired = !user?.otp_expires_at || new Date(user.otp_expires_at) < new Date();
    if (!user || !user.otp || expired || otpHash(req.body.otp) !== user.otp) return res.status(400).json({ success: false, message: 'The OTP is invalid or has expired.' });
    const resetToken = jwt.sign({ sub: user.id, purpose: 'password_reset' }, process.env.JWT_SECRET, { expiresIn: process.env.RESET_TOKEN_EXPIRES_IN || '15m' });
    return res.json({ success: true, message: 'OTP verified. You can now reset your password.', resetToken });
  } catch (error) { next(error); }
};

exports.resetPassword = async (req, res, next) => {
  try {
    const payload = jwt.verify(req.body.resetToken, process.env.JWT_SECRET);
    if (payload.purpose !== 'password_reset') return res.status(400).json({ success: false, message: 'Invalid password reset token.' });
    const user = await User.findPublicById(payload.sub);
    if (!user) return res.status(400).json({ success: false, message: 'User account was not found.' });
    await User.updatePassword(user.id, await bcrypt.hash(req.body.newPassword, 12));
    return res.json({ success: true, message: 'Password reset successful. Please sign in with your new password.' });
  } catch (error) {
    return res.status(400).json({ success: false, message: 'The password reset token is invalid or has expired.' });
  }
};

exports.profile = async (req, res) => res.json({ success: true, user: serializeUser(req.user) });
