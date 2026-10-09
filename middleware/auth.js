const jwt = require('jsonwebtoken');
const User = require('../models/User');
const pool = require('../config/database');
const { ALL_ROLES } = require('../config/roles');

const authenticate = async (req, res, next) => {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ success: false, message: 'Authentication token is required.' });
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findPublicById(payload.sub);
    if (!user) return res.status(401).json({ success: false, message: 'User account was not found.' });
    if (!ALL_ROLES.includes(user.role)) return res.status(403).json({ success: false, message: 'This account role is no longer supported.' });
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ success: false, message: 'Your session is invalid or has expired.' });
  }
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
    // Accounts created by older modules may not yet have their optional profile row.
    const accountStatus = rows[0]?.account_status;
    const inactiveBusiness = BUSINESS_ROLES.includes(req.user?.role) && ['rejected', 'suspended'].includes(accountStatus);
    const inactiveNonBusiness = !BUSINESS_ROLES.includes(req.user?.role) && accountStatus && accountStatus !== 'active';
    if (inactiveBusiness || inactiveNonBusiness) return res.status(403).json({ success: false, message: 'Your account is not active. Please contact an administrator.' });
    next();
  } catch (error) { next(error); }
};

module.exports = { authenticate, authorizeRoles, authorizeBusiness, requireActiveAccount, BUSINESS_ROLES };
