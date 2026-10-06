const pool = require('../config/database');

exports.getDonationCertificate = async (req, res, next) => {
  try {
    const donationId = req.params.id;
    const [rows] = await pool.execute(`
       SELECT d.id AS donation_id, d.food_name, d.quantity, d.number_of_meals, d.created_at, d.status,
              u.id AS donor_user_id, COALESCE(u.business_name, u.full_name) AS donor_name, u.city AS donor_city,
              n.ngo_name, n.registration_number AS ngo_reg_no, ngo_user.city AS ngo_city,
              d.updated_at AS completion_time
      FROM donations d
      JOIN users u ON u.id = d.business_user_id
      LEFT JOIN accepted_donations ad ON ad.donation_id = d.id
      LEFT JOIN ngos n ON n.id = ad.ngo_id
      LEFT JOIN users ngo_user ON ngo_user.id = n.user_id
       WHERE d.id = ? AND d.deleted_at IS NULL AND d.status = 'completed'
    `, [donationId]);

    if (!rows.length) return res.status(404).json({ success: false, message: 'Donation not found.' });

    const data = rows[0];
    const isOwner = Number(data.donor_user_id) === Number(req.user.id);
    const [ngoAccess] = await pool.execute(
      'SELECT 1 FROM accepted_donations ad JOIN ngos n ON n.id = ad.ngo_id WHERE ad.donation_id = ? AND n.user_id = ? LIMIT 1',
      [donationId, req.user.id]
    );
    if (!isOwner && !ngoAccess.length && req.user.role !== 'admin') return res.status(403).json({ success: false, message: 'You do not have access to this certificate.' });
    const meals = Number(data.number_of_meals) || 0;

    const certificate = {
      certificateNumber: `FB-CERT-${String(data.donation_id).padStart(6, '0')}`,
      issueDate: new Date().toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' }),
       completionDate: new Date(data.completion_time).toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' }),
      donor: {
        name: data.donor_name,
        city: data.donor_city
      },
      receivingNgo: {
        name: data.ngo_name || 'Verified Partner NGO',
        regNo: data.ngo_reg_no || 'REG-NGO-APPROVED',
        city: data.ngo_city || data.donor_city
      },
      donationDetails: {
        id: data.donation_id,
        foodName: data.food_name,
        quantity: data.quantity,
         mealsRescued: meals
      },
       verificationStatus: 'COMPLETED & VERIFIED',
      issuer: 'Food Rescue National Food Rescue Initiative'
    };

    return res.json({ success: true, certificate });
  } catch (error) {
    next(error);
  }
};
