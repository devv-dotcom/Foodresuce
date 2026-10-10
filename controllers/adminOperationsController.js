const pool = require('../config/database');

const page = query => ({ limit: Math.min(Math.max(Number(query.limit) || 25, 1), 100), offset: Math.max(Number(query.offset) || 0, 0) });
const allowedStatuses = ['pending', 'pickup_scheduled', 'volunteer_assigned', 'pickup_started', 'food_collected', 'on_the_way', 'delivered', 'completed', 'cancelled'];

exports.listPickups = async (req, res, next) => {
  try {
    const conditions = [];
    const values = [];
    if (allowedStatuses.includes(req.query.status)) { conditions.push('pr.status = ?'); values.push(req.query.status); }
    if (req.query.q?.trim()) {
      const term = `%${req.query.q.trim().slice(0, 100)}%`;
      conditions.push('(d.food_name LIKE ? OR u.business_name LIKE ? OR u.full_name LIKE ? OR n.ngo_name LIKE ?)');
      values.push(term, term, term, term);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const { limit, offset } = page(req.query);
    const [pickups] = await pool.execute(`SELECT pr.id, pr.donation_id, pr.status, pr.pickup_date, pr.pickup_time, pr.created_at, pr.updated_at,
      pr.distribution_completed_at, pr.distribution_location, pr.people_served, d.food_name,
      COALESCE(u.business_name, u.full_name) AS donor_name, n.ngo_name
      FROM pickup_requests pr JOIN donations d ON d.id = pr.donation_id
      JOIN users u ON u.id = pr.business_id JOIN ngos n ON n.id = pr.ngo_id
      ${where} ORDER BY pr.updated_at DESC LIMIT ${limit} OFFSET ${offset}`, values);
    const [[{ total }]] = await pool.execute(`SELECT COUNT(*) AS total FROM pickup_requests pr JOIN donations d ON d.id = pr.donation_id
      JOIN users u ON u.id = pr.business_id JOIN ngos n ON n.id = pr.ngo_id ${where}`, values);
    const [[summary]] = await pool.execute(`SELECT
      SUM(status = 'pending') AS pending,
      SUM(status IN ('pickup_scheduled', 'volunteer_assigned')) AS assigned,
      SUM(status IN ('pickup_started', 'food_collected', 'on_the_way')) AS in_progress,
      SUM(status IN ('delivered', 'completed') AND DATE(COALESCE(distribution_completed_at, updated_at)) = CURDATE()) AS completed_today,
      SUM(status IN ('delivered', 'completed')) AS completed,
      SUM(status = 'cancelled') AS cancelled
      FROM pickup_requests`);
    return res.json({ success: true, pickups, total: Number(total), limit, offset, summary });
  } catch (error) { next(error); }
};
