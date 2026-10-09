const pool = require('../config/database');

exports.getLeaderboard = async (req, res, next) => {
  try {
    const period = req.query.period || 'all_time';
    const BUSINESS_ROLES = ['restaurant', 'hotel', 'bakery', 'supermarket', 'catering', 'marriage_hall'];
    const businessRolesIn = BUSINESS_ROLES.map(() => '?').join(', ');

    // 1. Top Donors
    const [donors] = await pool.execute(`
      SELECT u.id, COALESCE(u.business_name, u.full_name) AS name, u.role, u.city,
             COALESCE(u.impact_points, 0) AS impact_points,
             COALESCE(u.badge_level, 'Bronze Hero') AS badge_level,
             COUNT(d.id) AS donations_count,
             COALESCE(SUM(d.number_of_meals), 0) AS total_meals
      FROM users u
      LEFT JOIN donations d ON d.business_user_id = u.id AND d.deleted_at IS NULL
      WHERE u.role IN (${businessRolesIn})
      GROUP BY u.id
      ORDER BY total_meals DESC, impact_points DESC
      LIMIT 10
    `, BUSINESS_ROLES);

    // 2. Top NGOs
    const [ngos] = await pool.execute(`
      SELECT n.id AS ngo_id, n.ngo_name AS name, u.city,
             COALESCE(u.impact_points, 0) AS impact_points,
             COUNT(ad.id) AS rescues_completed
      FROM ngos n
      JOIN users u ON u.id = n.user_id
      LEFT JOIN accepted_donations ad ON ad.ngo_id = n.id AND ad.status = 'completed'
      GROUP BY n.id, n.ngo_name, u.city, u.impact_points
      ORDER BY rescues_completed DESC, impact_points DESC
      LIMIT 10
    `);

    const addRanks = items => items.map((item, index) => ({
      rank: index + 1,
      medal: index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `#${index + 1}`,
      ...item
    }));

    return res.json({
      success: true,
      period,
      topDonors: addRanks(donors),
      topNgos: addRanks(ngos)
    });
  } catch (error) {
    next(error);
  }
};

exports.getMyRewards = async (req, res, next) => {
  try {
    const [rows] = await pool.execute(
      `SELECT id, full_name, email, role, business_name, impact_points, badge_level FROM users WHERE id = ?`,
      [req.user.id]
    );
    if (!rows.length) return res.status(404).json({ success: false, message: 'User not found.' });

    const user = rows[0];
    const points = user.impact_points || 0;
    let nextTier = 'Silver Saver (400 pts)';
    let pointsNeeded = Math.max(0, 400 - points);
    let progress = Math.min(100, Math.round((points / 400) * 100));

    if (points >= 2000) {
      nextTier = 'Maximum Tier: Platinum Champion';
      pointsNeeded = 0;
      progress = 100;
    } else if (points >= 1000) {
      nextTier = 'Platinum Hero (2,000 pts)';
      pointsNeeded = 2000 - points;
      progress = Math.min(100, Math.round(((points - 1000) / 1000) * 100));
    } else if (points >= 400) {
      nextTier = 'Gold Guardian (1,000 pts)';
      pointsNeeded = 1000 - points;
      progress = Math.min(100, Math.round(((points - 400) / 600) * 100));
    }

    return res.json({
      success: true,
      points,
      badge: user.badge_level || 'Bronze Hero',
      nextTier,
      pointsNeeded,
      progressPercentage: progress
    });
  } catch (error) {
    next(error);
  }
};
