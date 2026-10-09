const pool = require('../config/database');
const User = require('../models/User');

exports.getProfile = async (req, res, next) => {
  try {
    const user = await User.findPublicById(req.user.id);
    if (!user) return res.status(404).json({ success: false, message: 'Profile not found.' });

    let isVerified = true;
    let isActive = true;

    if (user.role === 'ngo') {
      const [rows] = await pool.execute(`SELECT is_verified, account_status FROM ngos WHERE user_id = ? LIMIT 1`, [user.id]);
      if (rows[0]) {
        isVerified = Boolean(rows[0].is_verified);
        isActive = !['rejected', 'suspended'].includes(rows[0].account_status);
      }
    }

    return res.json({
      success: true,
      profile: {
        id: user.id,
        name: user.full_name,
        fullName: user.full_name,
        email: user.email,
        phone: user.mobile,
        mobile: user.mobile,
        role: user.role,
        businessName: user.business_name,
        address: user.address,
        city: user.city,
        state: user.state,
        pincode: user.pincode,
        latitude: user.latitude,
        longitude: user.longitude,
        profileImage: user.profile_image,
        isVerified: isVerified,
        isActive: isActive,
        createdAt: user.created_at
      }
    });
  } catch (error) { next(error); }
};

exports.updateProfile = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const fullName = req.body.fullName || req.body.name || req.user.full_name;
    const mobile = req.body.phone || req.body.mobile || req.user.mobile;
    const address = req.body.address || req.user.address;
    const city = req.body.city || req.user.city;
    const state = req.body.state || req.user.state;
    const pincode = req.body.pincode || req.user.pincode;
    const latitude = req.body.latitude !== undefined ? Number(req.body.latitude) : req.user.latitude;
    const longitude = req.body.longitude !== undefined ? Number(req.body.longitude) : req.user.longitude;

    await pool.execute(
      `UPDATE users
       SET full_name = ?, mobile = ?, address = ?, city = ?, state = ?, pincode = ?, latitude = ?, longitude = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [fullName, mobile, address, city, state, pincode, latitude, longitude, userId]
    );

    const updatedUser = await User.findPublicById(userId);

    return res.json({
      success: true,
      message: 'Profile updated successfully.',
      profile: {
        id: updatedUser.id,
        name: updatedUser.full_name,
        email: updatedUser.email,
        phone: updatedUser.mobile,
        role: updatedUser.role,
        city: updatedUser.city,
        address: updatedUser.address,
        latitude: updatedUser.latitude,
        longitude: updatedUser.longitude,
        profileImage: updatedUser.profile_image
      }
    });
  } catch (error) { next(error); }
};

exports.uploadProfileImage = async (req, res, next) => {
  try {
    if (!req.file) return res.status(422).json({ success: false, message: 'Profile image file is required.' });
    const imageUrl = `/uploads/profile/${req.file.filename}`;
    
    await pool.execute(
      `UPDATE users SET profile_image = ? WHERE id = ?`,
      [imageUrl, req.user.id]
    );

    return res.json({
      success: true,
      message: 'Profile image updated successfully.',
      imageUrl: imageUrl
    });
  } catch (error) { next(error); }
};
