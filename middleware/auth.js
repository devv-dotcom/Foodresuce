const jwt = require('jsonwebtoken');
const User = require('../models/User');
const pool = require('../config/database');
const { ALL_ROLES } = require('../config/roles');

const authenticate = async (req, res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ success: false, message: 'Authentication token is required.' });

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch (error) {
    if (error.name === 'TokenExpiredError' || error.name === 'JsonWebTokenError' || error.name === 'NotBeforeError') {
      return res.status(401).json({ success: false, message: 'Your session is invalid or has expired.' });
    }
    return next(error);
  }

  try {
    const user = await User.findAuthById(payload.sub);
    if (!user) return res.status(401).json({ success: false, message: 'User account was not found.' });
    if (Number(payload.ver || 0) !== Number(user.token_version || 0)) {
      return res.status(401).json({ success: false, message: 'Your session is invalid or has expired.' });
    }
    if (['suspended', 'deleted', 'rejected'].includes(user.account_status)) {
      return res.status(403).json({ success: false, message: 'Your account is not active. Please contact an administrator.' });
    }
    if (!ALL_ROLES.includes(user.role)) return res.status(403).json({ success: false, message: 'This account role is no longer supported.' });
    req.user = user;
    return next();
  } catch (error) { return next(error); }
};

const authorizeRoles = (...roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) return res.status(403).json({ success: false, message: 'You do not have permission to perform this action.' });
  next();
};

const { BUSINESS_ROLES } = require('../config/roles');
const authorizeBusiness = authorizeRoles(...BUSINESS_ROLES);

const requireActiveAccount = async (req, res, next) => {
  try {
    let sql = null;
    if (BUSINESS_ROLES.includes(req.user?.role)) sql = 'SELECT account_status FROM business_profiles WHERE user_id = ? LIMIT 1';
    if (req.user?.role === 'ngo') sql = 'SELECT account_status FROM ngos WHERE user_id = ? LIMIT 1';
    if (req.user?.role === 'volunteer') sql = 'SELECT account_status FROM volunteers WHERE user_id = ? LIMIT 1';
    if (req.user?.role === 'admin') sql = 'SELECT account_status FROM admins WHERE user_id = ? LIMIT 1';
    if (!sql) return next();
    const [rows] = await pool.execute(sql, [req.user.id]);
    // NGO and donor/business registrations are active without administrator approval.
    // Keep suspension and rejection effective; other account types still require active status.
    const status = rows[0]?.account_status;
    const selfActivatedRole = req.user?.role === 'ngo' || BUSINESS_ROLES.includes(req.user?.role);
    if (status && (selfActivatedRole ? ['pending', 'rejected', 'suspended'].includes(status) : status !== 'active')) {
      return res.status(403).json({ success: false, message: 'Your account is not active. Please contact an administrator.' });
    }
    next();
  } catch (error) { next(error); }
};

module.exports = { authenticate, authorizeRoles, authorizeBusiness, requireActiveAccount, BUSINESS_ROLES };
