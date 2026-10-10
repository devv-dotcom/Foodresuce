const pool = require('../config/database');
const { BUSINESS_ROLES } = require('../config/roles');
const buildIn = items => items.map(() => '?').join(', ');

module.exports = {
  async findByEmail(email) {
    const [rows] = await pool.execute(
      `SELECT a.id AS admin_id, a.account_status, u.id, u.full_name, u.email, u.password, u.role, u.token_version
       FROM admins a JOIN users u ON u.id = a.user_id WHERE LOWER(u.email) = LOWER(?) AND u.role = 'admin' LIMIT 1`, [email]
    );
    return rows[0] || null;
  },
  async findByUserId(userId) {
    const [rows] = await pool.execute(
      `SELECT a.id AS admin_id, a.account_status, u.id, u.full_name, u.email, u.role
       FROM admins a JOIN users u ON u.id = a.user_id WHERE a.user_id = ? AND u.role = 'admin' LIMIT 1`, [userId]
    );
    return rows[0] || null;
  },
  async updateLastLogin(adminId) { await pool.execute('UPDATE admins SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?', [adminId]); },
  async dashboard() {
    const [[users], [donations], [deliveries], [today], [meals], [weekly], [monthly]] = await Promise.all([
      pool.execute(`SELECT COUNT(*) AS total_users, SUM(role IN (${buildIn(BUSINESS_ROLES)})) AS total_businesses, SUM(role = 'ngo') AS total_ngos, SUM(role = 'volunteer') AS total_volunteers FROM users`, BUSINESS_ROLES),
      pool.execute('SELECT COUNT(*) AS total_donations, SUM(status = \'cancelled\') AS cancelled_donations FROM donations WHERE deleted_at IS NULL'),
      pool.execute("SELECT SUM(status = 'completed') AS completed_deliveries, SUM(status NOT IN ('completed', 'cancelled')) AS pending_deliveries FROM pickup_requests"),
      pool.execute('SELECT COUNT(*) AS today_donations FROM donations WHERE deleted_at IS NULL AND DATE(created_at) = CURDATE()'),
      pool.execute("SELECT COALESCE(SUM(number_of_meals), 0) AS meals_rescued FROM donations WHERE deleted_at IS NULL AND status IN ('delivered', 'completed')"),
      pool.execute('SELECT DATE(created_at) AS date, COUNT(*) AS donations FROM donations WHERE deleted_at IS NULL AND created_at >= DATE_SUB(CURDATE(), INTERVAL 6 DAY) GROUP BY DATE(created_at) ORDER BY date'),
      pool.execute('SELECT DATE_FORMAT(created_at, \'%Y-%m\') AS month, COUNT(*) AS donations FROM donations WHERE deleted_at IS NULL AND created_at >= DATE_SUB(CURDATE(), INTERVAL 5 MONTH) GROUP BY month ORDER BY month')
    ]);
    return { ...users[0], ...donations[0], ...deliveries[0], ...today[0], ...meals[0], weeklyActivity: weekly[0], monthlyGrowth: monthly[0] };
  },
  async listBusinesses({ q, category, limit, offset }) {
    const clauses = [`u.role IN (${buildIn(BUSINESS_ROLES)})`]; const values = [...BUSINESS_ROLES];
    if (q) { clauses.push('(u.full_name LIKE ? OR u.business_name LIKE ? OR u.email LIKE ? OR u.city LIKE ?)'); values.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`); }
    if (category && BUSINESS_ROLES.includes(category)) { clauses.push('u.role = ?'); values.push(category); }
    const [rows] = await pool.execute(`SELECT u.id, u.full_name, u.email, u.mobile, u.business_name, u.role, u.city, u.state, u.created_at, bp.account_status FROM users u LEFT JOIN business_profiles bp ON bp.user_id = u.id WHERE ${clauses.join(' AND ')} ORDER BY u.created_at DESC LIMIT ? OFFSET ?`, [...values, limit, offset]);
    return rows;
  },
  async listNgos({ q, limit, offset }) {
    const values = []; let where = "u.role = 'ngo'";
    if (q) { where += ' AND (u.full_name LIKE ? OR n.ngo_name LIKE ? OR u.email LIKE ? OR u.city LIKE ?)'; values.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`); }
    const [rows] = await pool.execute(`SELECT n.id AS ngo_id, u.id, u.full_name, u.email, u.mobile, u.city, u.state, u.created_at, n.ngo_name, n.registration_number, n.account_status FROM ngos n JOIN users u ON u.id = n.user_id WHERE ${where} ORDER BY u.created_at DESC LIMIT ? OFFSET ?`, [...values, limit, offset]);
    return rows;
  },
  async listVolunteers({ q, limit, offset }) {
    const values = []; let where = "u.role = 'volunteer'";
    if (q) { where += ' AND (u.full_name LIKE ? OR u.email LIKE ? OR u.city LIKE ?)'; values.push(`%${q}%`, `%${q}%`, `%${q}%`); }
    const [rows] = await pool.execute(`SELECT v.id AS volunteer_id, u.id, u.full_name, u.email, u.mobile, u.city, u.state, u.created_at, v.vehicle_type, v.availability, v.account_status, v.rating, v.completed_deliveries FROM volunteers v JOIN users u ON u.id = v.user_id WHERE ${where} ORDER BY u.created_at DESC LIMIT ? OFFSET ?`, [...values, limit, offset]);
    return rows;
  },
  async setAccountStatus(connection, kind, userId, status) {
    if (kind === 'business') return connection.execute(
      `INSERT INTO business_profiles (user_id, business_name, business_type, account_status)
       SELECT u.id, COALESCE(u.business_name, u.full_name), u.role, ? FROM users u
       WHERE u.id = ? AND u.role IN (${buildIn(BUSINESS_ROLES)})
       ON DUPLICATE KEY UPDATE account_status = VALUES(account_status)`,
      [status, userId, ...BUSINESS_ROLES]
    );
    if (kind === 'ngo') return connection.execute("UPDATE ngos n JOIN users u ON u.id = n.user_id SET n.account_status = ? WHERE u.id = ? AND u.role = 'ngo'", [status, userId]);
    return connection.execute("UPDATE volunteers v JOIN users u ON u.id = v.user_id SET v.account_status = ? WHERE u.id = ? AND u.role = 'volunteer'", [status, userId]);
  },
  async deleteUser(connection, kind, userId) {
    const roleSql = kind === 'business' ? `IN (${buildIn(BUSINESS_ROLES)})` : '= ?';
    const values = kind === 'business' ? [userId, ...BUSINESS_ROLES] : [userId, kind];
    return connection.execute(`DELETE FROM users WHERE id = ? AND role ${roleSql}`, values);
  }
};
