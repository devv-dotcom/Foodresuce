const pool = require('../config/database');
const Donation = require('../models/Donation');

// Haversine formula in JS for distance in km
function calculateDistance(lat1, lon1, lat2, lon2) {
  if (!lat1 || !lon1 || !lat2 || !lon2) return null;
  const R = 6371; // Radius of Earth in KM
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Number((R * c).toFixed(2));
}

exports.getSmartMatch = async (req, res, next) => {
  try {
    const donationId = req.params.id;
    const donation = await Donation.findById(donationId);
    if (!donation) return res.status(404).json({ success: false, message: 'Donation not found.' });
    if (donation.business_user_id !== req.user.id) return res.status(403).json({ success: false, message: 'You can only match NGOs for your own donation.' });

    const now = Date.now();
    const expiryDate = new Date(donation.expiry_time).getTime();
    const hoursRemaining = Math.max(0, (expiryDate - now) / (1000 * 60 * 60));
    const isUrgent = hoursRemaining <= 2.5;

    const donorLat = Number(donation.latitude) || null;
    const donorLon = Number(donation.longitude) || null;
    const donorCity = donation.city || '';

    // Fetch active NGOs with location
    const [ngos] = await pool.execute(`
      SELECT n.id AS ngo_id, n.user_id, n.ngo_name, u.full_name, u.city, u.latitude, u.longitude,
             (SELECT COUNT(*) FROM accepted_donations ad WHERE ad.ngo_id = n.id AND ad.status = 'accepted') AS pending_count,
             (SELECT COUNT(*) FROM accepted_donations ad WHERE ad.ngo_id = n.id AND ad.status = 'completed') AS completed_count
      FROM ngos n
      JOIN users u ON u.id = n.user_id
      WHERE n.account_status = 'active'
    `);

    // Score and rank NGOs
    const scoredNgos = ngos.map(ngo => {
      let distanceKm = calculateDistance(donorLat, donorLon, Number(ngo.latitude), Number(ngo.longitude));
      if (distanceKm === null) {
        // Fallback: city match gets 3.5 km default, other city gets 25 km
        distanceKm = (ngo.city && donorCity && ngo.city.toLowerCase() === donorCity.toLowerCase()) ? 3.5 : 25.0;
      }

      // Proximity score (Max 50 pts)
      const proximityScore = Math.max(0, 50 - (distanceKm * 2));
      // Reliability & past record (Max 25 pts)
      const experienceScore = Math.min(25, ngo.completed_count * 2.5);
      // Capacity score (Max 25 pts: lower pending load is better)
      const capacityScore = Math.max(0, 25 - (ngo.pending_count * 5));

      const totalScore = Math.round(proximityScore + experienceScore + capacityScore);
      const estimatedTransitMins = Math.max(10, Math.round((distanceKm / 25) * 60) + 12);

      return {
        ngoId: ngo.ngo_id,
        ngoName: ngo.ngo_name || ngo.full_name,
        city: ngo.city,
        distanceKm,
        estimatedTransitMins,
        matchScore: Math.min(99, Math.max(35, totalScore)),
        pendingRescues: ngo.pending_count
      };
    }).sort((a, b) => b.matchScore - a.matchScore);

    return res.json({
      success: true,
      donation: {
        id: donation.id,
        foodName: donation.food_name,
        meals: donation.number_of_meals,
        quantity: donation.quantity,
        hoursRemaining: Number(hoursRemaining.toFixed(1)),
        isUrgent
      },
      recommendedNgo: scoredNgos[0] || null,
      topNgos: scoredNgos.slice(0, 4)
    });
  } catch (error) {
    next(error);
  }
};
