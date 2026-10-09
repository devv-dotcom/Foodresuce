const path = require('path');
const bcrypt = require('bcrypt');
const pool = require('../config/database');
const User = require('../models/User');
const Business = require('../models/Business');
const BusinessProfile = require('../models/BusinessProfile');
const BusinessImage = require('../models/BusinessImage');

const buildProfile = async userId => {
  const [user, profile, images] = await Promise.all([
    Business.findDashboardUser(userId),
    BusinessProfile.findByUserId(userId),
    BusinessImage.findByUserId(userId)
  ]);
  if (!user) return null;
  return {
    id: user.id,
    ownerName: user.full_name,
    email: user.email,
    phone: user.mobile,
    businessName: profile?.business_name || user.business_name || '',
    businessType: profile?.business_type || user.role,
    address: user.address,
    city: user.city,
    state: user.state,
    pincode: user.pincode,
    latitude: user.latitude,
    longitude: user.longitude,
    ownerProfileImage: user.profile_image,
    logo: images.logo || null,
    coverImage: images.cover || null,
    accountStatus: profile?.account_status || 'active',
    registrationDate: user.created_at,
    isVerified: Boolean(user.is_verified)
  };
};

exports.getDashboard = async (req, res, next) => {
  try {
    const profile = await buildProfile(req.user.id);
    const [statsRows] = await pool.execute(
      `SELECT 
        COUNT(*) AS totalDonations,
        SUM(status = 'completed') AS completedDonations,
        SUM(status = 'available' AND expiry_time > NOW() AND deleted_at IS NULL) AS pendingDonations,
        SUM(status = 'cancelled') AS cancelledDonations,
        COALESCE(SUM(number_of_meals), 0) AS foodSaved
       FROM donations 
       WHERE business_user_id = ?`,
      [req.user.id]
    );
    const stats = statsRows[0] || {};
    return res.json({
      success: true,
      dashboard: {
        businessName: profile.businessName,
        businessType: profile.businessType,
        role: req.user.role,
        ownerName: profile.ownerName,
        profilePhoto: profile.ownerProfileImage,
        logo: profile.logo,
        email: profile.email,
        phone: profile.phone,
        address: profile.address,
        city: profile.city,
        state: profile.state,
        registrationDate: profile.registrationDate,
        accountStatus: profile.accountStatus,
        statistics: {
          totalDonations: Number(stats.totalDonations || 0),
          completedDonations: Number(stats.completedDonations || 0),
          pendingDonations: Number(stats.pendingDonations || 0),
          cancelledDonations: Number(stats.cancelledDonations || 0),
          foodSaved: Number(stats.foodSaved || 0)
        }
      }
    });
  } catch (error) { next(error); }
};

// Donations are scoped on the server so a business never receives another
// business's operational data from its dashboard.
exports.getDonations = async (req, res, next) => {
  try {
    const donations = await Donation.list({
      where: 'WHERE d.business_user_id = ?',
      values: [req.user.id],
      limit: 50,
      offset: 0,
      includeDeleted: true
    });
    return res.json({ success: true, donations });
  } catch (error) { next(error); }
};

exports.getProfile = async (req, res, next) => {
  try {
    const profile = await buildProfile(req.user.id);
    return res.json({ success: true, profile });
  } catch (error) { next(error); }
};

exports.updateProfile = async (req, res, next) => {
  const connection = await pool.getConnection();
  try {
    if (req.body.businessType !== req.user.role) {
      return res.status(400).json({ success: false, message: 'Business type must match the authenticated account role.' });
    }
    await connection.beginTransaction();
    if (await Business.emailInUse(connection, req.body.email, req.user.id)) {
      await connection.rollback();
      return res.status(409).json({ success: false, message: 'Another account already uses this email.' });
    }
    await Business.updateUser(connection, req.user.id, req.body);
    await BusinessProfile.upsert(connection, req.user.id, req.body);
    await connection.commit();
    return res.json({ success: true, message: 'Profile updated successfully.', profile: await buildProfile(req.user.id) });
  } catch (error) {
    await connection.rollback();
    next(error);
  } finally { connection.release(); }
};

const saveImage = imageType => async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'Please upload a PNG, JPG, or JPEG image no larger than 2MB.' });
    const imagePath = `/${path.relative(path.join(__dirname, '..'), req.file.path).split(path.sep).join('/')}`;
    await BusinessImage.upsert(req.user.id, imageType, imagePath);
    return res.status(201).json({ success: true, message: `${imageType === 'logo' ? 'Logo' : 'Cover image'} uploaded successfully.`, image: imagePath });
  } catch (error) { next(error); }
};

exports.uploadLogo = saveImage('logo');
exports.uploadCover = saveImage('cover');

exports.changePassword = async (req, res, next) => {
  try {
    const user = await User.findByEmail(req.user.email);
    if (!user || !(await bcrypt.compare(req.body.currentPassword, user.password))) {
      return res.status(400).json({ success: false, message: 'Current password is incorrect.' });
    }
    await Business.changePassword(req.user.id, await bcrypt.hash(req.body.newPassword, 12));
    return res.json({ success: true, message: 'Password changed successfully.' });
  } catch (error) { next(error); }
};
