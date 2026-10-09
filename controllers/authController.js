const bcrypt = require('bcrypt');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const pool = require('../config/database');
const User = require('../models/User');
const { sendPasswordOtp, sendLoginOtp } = require('../utils/mail');
const { BUSINESS_ROLES } = require('../config/roles');
const { isLoginOtpEnabled } = require('../config/authConfig');

const signAccessToken = user => jwt.sign({ sub: user.id, role: user.role }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });
const serializeUser = user => ({ id: user.id, name: user.full_name, email: user.email, role: user.role, city: user.city, profileImage: user.profile_image });
const otpHash = otp => crypto.createHash('sha256').update(otp).digest('hex');
const loginOtpLifetimeMs = Number(process.env.LOGIN_OTP_TTL_MS || 10 * 60 * 1000);

const deliveryFailureMessage = error => {
  const detail = String(error?.message || '').toLowerCase();
  if (error?.code === 'EMAIL_PROVIDER_MISSING') {
    return 'Email delivery is not configured. Add RESEND_API_KEY and a verified MAIL_FROM sender to Render.';
  }
  if (error?.code === 'RESEND_MAIL_FROM_MISSING') {
    return 'Set MAIL_FROM to an email address on a domain verified in Resend, then try again.';
  }
  if (error?.code === 'RESEND_HTTP_401') {
    return 'Resend rejected the API key. Create or copy a valid Resend API key into Render.';
  }
  if (error?.code === 'RESEND_HTTP_403') {
    return 'Resend blocked this send. Check account activation and the verified sender domain in Resend.';
  }
  if (error?.code === 'RESEND_HTTP_400' || error?.code === 'RESEND_HTTP_422') {
    return 'Resend rejected the sender or message. Verify MAIL_FROM belongs to a verified domain and try again.';
  }
  if (error?.code === 'RESEND_HTTP_429') {
    return 'Resend is rate limiting email delivery. Wait a few minutes, then request a new code.';
  }
  if (error?.code?.startsWith('RESEND_HTTP_5')) {
    return 'Resend is temporarily unavailable. Wait a few minutes, then request a new code.';
  }
  if (error?.code === 'BREVO_API_KEY_MISSING') {
    return 'Email delivery is not configured. Add BREVO_API_KEY to the Render environment and redeploy.';
  }
  if (error?.code === 'BREVO_HTTP_401') {
    return 'Brevo rejected the API key. Create a new Brevo API key and update BREVO_API_KEY in Render.';
  }
  if (error?.code === 'BREVO_HTTP_402') {
    return 'Brevo has not activated transactional email for this account. Complete its account or sender checks, then try again.';
  }
  if (error?.code === 'BREVO_HTTP_403') {
    return 'Brevo blocked this send. Check account activation, sender verification, and any API IP restrictions.';
  }
  if (error?.code === 'BREVO_HTTP_429') {
    return 'Brevo is rate limiting email delivery. Wait a few minutes, then request a new code.';
  }
  if (error?.code?.startsWith('BREVO_HTTP_5')) {
    return 'Brevo is temporarily unavailable. Wait a few minutes, then request a new code.';
  }
  if (/sender|from.*email|invalid.*email/.test(detail)) {
    return error?.provider === 'resend'
      ? 'The OTP sender is not verified. Verify the sender domain in Resend, then try again.'
      : 'The OTP sender is not verified. Verify the MAIL_FROM email in Brevo, then try again.';
  }
  if (/api.?key|unauthori[sz]ed|forbidden|authentication/.test(detail)) {
    return 'The email service needs a valid Brevo API key. Update BREVO_API_KEY in Render, then try again.';
  }
  if (/domain|dmarc|dkim|spf|freemail/.test(detail)) {
    return 'Brevo rejected the sender domain authentication. Use a sender on a domain you can authenticate with DKIM and DMARC.';
  }
  return 'We could not deliver a sign-in code. Please try again later.';
};


const NGO = require('../models/NGO');

exports.register = async (req, res, next) => {
  const connection = await pool.getConnection();
  try {
    const role = (req.body.role || 'restaurant').toLowerCase();
    if (role === 'admin') return res.status(403).json({ success: false, message: 'Administrator accounts can only be created by an existing administrator.' });
    const existing = await User.findByEmail(req.body.email);
    if (existing) return res.status(409).json({ success: false, message: 'An account with this email already exists.' });
    
    await connection.beginTransaction();
    const password = await bcrypt.hash(req.body.password, 12);
    const [userResult] = await connection.execute(
      `INSERT INTO users
        (full_name, email, mobile, password, role, business_name, address, city, state, pincode, latitude, longitude)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        req.body.fullName,
        req.body.email.toLowerCase(),
        req.body.mobile || req.body.phone || '',
        password,
        role,
        req.body.businessName || req.body.ngoName || req.body.fullName,
        req.body.address || '',
        req.body.city || '',
        req.body.state || '',
        req.body.pincode || '',
        req.body.latitude ?? null,
        req.body.longitude ?? null
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
    } else if (role === 'ngo') {
      await NGO.create(connection, userId, {
        ngoName: req.body.ngoName || req.body.fullName,
        registrationNumber: req.body.registrationNumber || null,
        mission: req.body.mission || 'Community food rescue and distribution'
      });
    }

    await connection.commit();
    const user = await User.findPublicById(userId);
    if (role === 'ngo') {
      return res.status(201).json({ success: true, message: 'NGO registration received. An administrator must approve it before sign-in.', user: serializeUser(user) });
    }
    const token = signAccessToken(user);

    return res.status(201).json({ success: true, message: 'Registration successful! Welcome to Food Rescue.', token, user: serializeUser(user) });
  } catch (error) {
    await connection.rollback();
    next(error);
  } finally {
    connection.release();
  }
};

exports.login = async (req, res, next) => {
  try {
    const email = (req.body.email || '').trim();
    const user = await User.findByEmail(email);
    const valid = user && await bcrypt.compare(req.body.password, user.password);
    if (!valid) return res.status(401).json({ success: false, message: 'Invalid email or password.' });
    if (user.role === 'admin') {
      return res.status(403).json({ success: false, message: 'Administrators must use the administrator sign-in page.' });
    }

    const isDonorUser = BUSINESS_ROLES.includes(user.role);

    // Check account status
    if (isDonorUser) {
      const [rows] = await pool.execute('SELECT account_status FROM business_profiles WHERE user_id = ? LIMIT 1', [user.id]);
      const status = rows[0]?.account_status || 'active';
      if (status === 'rejected') return res.status(403).json({ success: false, message: 'Your business account application was rejected.' });
      if (status === 'suspended') return res.status(403).json({ success: false, message: 'Your business account has been suspended.' });
    } else if (user.role === 'ngo') {
      const [rows] = await pool.execute('SELECT account_status FROM ngos WHERE user_id = ? LIMIT 1', [user.id]);
      if (rows[0] && rows[0].account_status === 'pending') return res.status(403).json({ success: false, message: 'Your NGO application is awaiting administrator approval.' });
      if (rows[0] && rows[0].account_status === 'rejected') return res.status(403).json({ success: false, message: 'Your NGO application was rejected.' });
      if (rows[0] && rows[0].account_status === 'suspended') return res.status(403).json({ success: false, message: 'Your NGO account has been suspended.' });
    }

    // Temporarily allow password-only sign-in while transactional email is
    // unavailable. Email verification and password reset state are unchanged.
    if (!isLoginOtpEnabled()) {
      return res.json({
        success: true,
        requiresOtp: false,
        message: 'Login successful. Sign-in email codes are temporarily paused.',
        token: signAccessToken(user),
        user: serializeUser(user)
      });
    }

    const otp = crypto.randomInt(100000, 1000000).toString();
    await User.saveLoginOtp(user.email, otpHash(otp), new Date(Date.now() + loginOtpLifetimeMs));
    
    let mailError;
    try {
      await sendLoginOtp({ email: user.email, fullName: user.full_name, otp });
    } catch (error) {
      mailError = error;
      // Avoid logging provider response bodies or recipient data in production.
      console.warn('Login OTP email delivery failed.', { code: error.code || 'MAIL_DELIVERY_FAILED' });
    }

    if (mailError) {
      await User.clearLoginOtp(user.id);
      return res.status(503).json({ success: false, message: deliveryFailureMessage(mailError) });
    }

    return res.json({
      success: true,
      requiresOtp: true,
      email: user.email,
      role: user.role,
      message: 'We sent a 6-digit sign-in code to your email. Enter it to finish signing in.'
    });
  } catch (error) { next(error); }
};

exports.verifyLoginOtp = async (req, res, next) => {
  try {
    const user = await User.findByEmail(req.body.email);
    const expired = !user?.login_otp_expires_at || new Date(user.login_otp_expires_at) < new Date();
    const candidateHash = otpHash(req.body.otp);
    if (!user || !user.login_otp || expired || candidateHash !== user.login_otp) {
      return res.status(400).json({ success: false, message: 'The sign-in code is invalid or has expired.' });
    }
    const consumed = await User.consumeLoginOtp(user.id, candidateHash);
    if (!consumed) return res.status(400).json({ success: false, message: 'The sign-in code is invalid or has expired.' });
    await User.markEmailVerified(user.id);
    if (user.role === 'admin') await pool.execute('UPDATE admins SET last_login_at = CURRENT_TIMESTAMP WHERE user_id = ?', [user.id]);
    const publicUser = await User.findPublicById(user.id);
    return res.json({ success: true, message: 'Email verified. Welcome back to Food Rescue.', token: signAccessToken(publicUser), user: serializeUser(publicUser) });
  } catch (error) { next(error); }
};

exports.resendLoginOtp = async (req, res, next) => {
  try {
    if (!isLoginOtpEnabled()) {
      return res.status(410).json({ success: false, message: 'Sign-in email codes are temporarily paused. Sign in with your email and password.' });
    }
    const user = await User.findByEmail(req.body.email);
    // Deliberately preserve a uniform response to avoid account enumeration.
    if (!user) return res.json({ success: true, message: 'If that account is eligible, a new sign-in code has been sent.' });
    const otp = crypto.randomInt(100000, 1000000).toString();
    await User.saveLoginOtp(user.email, otpHash(otp), new Date(Date.now() + loginOtpLifetimeMs));
    try {
      await sendLoginOtp({ email: user.email, fullName: user.full_name, otp });
    } catch (mailError) {
      await User.clearLoginOtp(user.id);
      console.warn('Login OTP resend delivery failed.', { code: mailError.code || 'MAIL_DELIVERY_FAILED' });
      return res.status(503).json({ success: false, message: deliveryFailureMessage(mailError) });
    }
    return res.json({
      success: true,
      message: 'If that account is eligible, a new sign-in code has been sent.'
    });
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
