const Admin = require('../models/Admin');

const requireActiveAdmin = async (req, res, next) => {
  try {
    if (req.user?.role !== 'admin') return res.status(403).json({ success: false, message: 'Administrator access is required.' });
    const admin = await Admin.findByUserId(req.user.id);
    if (!admin || admin.account_status !== 'active') return res.status(403).json({ success: false, message: 'Your administrator account is not active.' });
    const configuredEmail = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
    if (!configuredEmail || String(admin.email || '').trim().toLowerCase() !== configuredEmail) {
      return res.status(403).json({ success: false, message: 'This administrator account is not authorized.' });
    }
    req.admin = admin;
    next();
  } catch (error) { next(error); }
};

module.exports = { requireActiveAdmin };
