const pool = require('../config/database');

// Public, non-identifying platform totals.  These values deliberately fall
// back to zero rather than invented statistics when there is no live data.
exports.getPublicImpact = async (_req, res, next) => {
  try {
    const [[totals], [active]] = await Promise.all([
      pool.execute(`SELECT COALESCE(SUM(number_of_meals), 0) AS mealsServed, COUNT(*) AS completedDonations
        FROM donations WHERE deleted_at IS NULL AND status IN ('delivered', 'completed')`),
      pool.execute(`SELECT COUNT(*) AS activeRescues FROM donations
        WHERE deleted_at IS NULL AND status IN ('available', 'accepted')`)
    ]);
    return res.json({ success: true, impact: {
      mealsServed: Number(totals.mealsServed || 0),
      peopleServed: Number(totals.mealsServed || 0),
      activeRescues: Number(active[0]?.activeRescues || 0),
      completedDonations: Number(totals.completedDonations || 0)
    } });
  } catch (error) { next(error); }
};

exports.getImpact = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const [rows] = await pool.execute(
      `SELECT COUNT(*) AS completedAssignments, COALESCE(SUM(d.number_of_meals), 0) AS mealsServed
       FROM assignments a JOIN donations d ON d.id = a.donation_id
       WHERE a.member_id = ? AND a.status = 'COMPLETED'`, [userId]
    );
    const completedAssignments = Number(rows[0]?.completedAssignments || 0);
    const mealsServed = Number(rows[0]?.mealsServed || 0);

    return res.json({
      success: true,
      impact: {
        totalFoodRescuedKg: 0,
        totalMealsServed: mealsServed,
        peopleServed: mealsServed,
        totalPickups: completedAssignments,
        totalDeliveries: completedAssignments,
        completedAssignments,
        monthlyImpact: []
      }
    });
  } catch (error) { next(error); }
};

exports.getMonthlyImpact = async (req, res, next) => {
  try {
    return res.json({ success: true, monthly: [] });
  } catch (error) { next(error); }
};
