const pool = require('../config/database');
const PickupRequest = require('./PickupRequest');

module.exports = {
  async accept(connection, donationId, ngoId) {
    const [donation] = await connection.execute(
      "UPDATE donations SET status = 'accepted' WHERE id = ? AND status = 'available' AND expiry_time > NOW() AND deleted_at IS NULL",
      [donationId]
    );
    if (!donation.affectedRows) return false;
    await connection.execute('INSERT INTO accepted_donations (donation_id, ngo_id) VALUES (?, ?)', [donationId, ngoId]);
    await PickupRequest.createForAcceptedDonation(connection, donationId, ngoId);
    return true;
  },
  async history(ngoId) {
    const [rows] = await pool.execute(
      `SELECT ad.id AS acceptance_id, ad.accepted_at, ad.status AS acceptance_status, d.*, c.name AS category_name,
       u.business_name, u.city AS business_city
       FROM accepted_donations ad JOIN donations d ON d.id = ad.donation_id
       JOIN food_categories c ON c.id = d.category_id JOIN users u ON u.id = d.business_user_id
       WHERE ad.ngo_id = ? ORDER BY ad.accepted_at DESC`,
      [ngoId]
    );
    return rows;
  }
};
