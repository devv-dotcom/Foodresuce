const pool = require('../config/database');
const { BUSINESS_ROLES } = require('../config/roles');

const donorRoleSlots = BUSINESS_ROLES.map(() => '?').join(', ');
const roleFilter = role => role === 'donor' ? { sql: `u.role IN (${donorRoleSlots})`, values: BUSINESS_ROLES } : role === 'ngo' || role === 'admin' ? { sql: 'u.role = ?', values: [role] } : null;
const statusSql = `COALESCE(NULLIF(u.account_status, 'active'), bp.account_status, n.account_status, a.account_status, 'active')`;
const baseSelect = `SELECT u.id, u.full_name, u.email, u.mobile, u.role, u.business_name, u.address, u.city, u.state, u.pincode,
  u.is_verified, u.account_status AS user_status, u.created_at, u.updated_at,
  bp.account_status AS donor_status, n.account_status AS ngo_status, n.ngo_name, n.registration_number,
  a.account_status AS admin_status, a.last_login_at,
  ${statusSql} AS account_status,
  (SELECT COUNT(*) FROM donations d WHERE d.business_user_id = u.id) AS donation_count,
  (SELECT COUNT(*) FROM account_warnings w WHERE w.target_user_id = u.id) AS warning_count,
  (SELECT MAX(l.created_at) FROM activity_logs l WHERE l.entity_type = 'account' AND l.entity_id = u.id) AS last_account_activity
  FROM users u
  LEFT JOIN business_profiles bp ON bp.user_id = u.id
  LEFT JOIN ngos n ON n.user_id = u.id
  LEFT JOIN admins a ON a.user_id = u.id`;

module.exports = {
  async list({ q, role, status, verified, warned, from, to, limit, offset }) {
    const conditions = [];
    const values = [];
    const roles = roleFilter(role);
    if (role && roles) { conditions.push(roles.sql); values.push(...roles.values); }
    else if (role === 'donor') { conditions.push(roles.sql); values.push(...roles.values); }
    else conditions.push(`u.role IN (${['admin', ...BUSINESS_ROLES, 'ngo'].map(() => '?').join(', ')})`), values.push('admin', ...BUSINESS_ROLES, 'ngo');
    if (q) { conditions.push('(u.full_name LIKE ? OR u.email LIKE ? OR u.business_name LIKE ? OR n.ngo_name LIKE ? OR CAST(u.id AS CHAR) = ?)'); const term = `%${q}%`; values.push(term, term, term, term, q); }
    if (status) { conditions.push(`${statusSql} = ?`); values.push(status); }
    if (verified === 'true') conditions.push('u.is_verified = TRUE');
    if (verified === 'false') conditions.push('u.is_verified = FALSE');
    if (warned === 'true') conditions.push('EXISTS (SELECT 1 FROM account_warnings w WHERE w.target_user_id = u.id)');
    if (warned === 'false') conditions.push('NOT EXISTS (SELECT 1 FROM account_warnings w WHERE w.target_user_id = u.id)');
    if (from) { conditions.push('u.created_at >= ?'); values.push(`${from} 00:00:00`); }
    if (to) { conditions.push('u.created_at < DATE_ADD(?, INTERVAL 1 DAY)'); values.push(to); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const [rows] = await pool.execute(`${baseSelect} ${where} ORDER BY u.created_at DESC LIMIT ${limit} OFFSET ${offset}`, values);
    const [[{ total }]] = await pool.execute(`SELECT COUNT(*) AS total FROM users u LEFT JOIN business_profiles bp ON bp.user_id = u.id LEFT JOIN ngos n ON n.user_id = u.id LEFT JOIN admins a ON a.user_id = u.id ${where}`, values);
    return { rows, total: Number(total) };
  },
  async summary() {
    const [rows] = await pool.execute(`SELECT COUNT(*) AS total,
      SUM(${statusSql} = 'active') AS active,
      SUM(${statusSql} = 'pending') AS pending,
      SUM(${statusSql} = 'suspended') AS suspended,
      SUM(EXISTS (SELECT 1 FROM account_warnings w WHERE w.target_user_id = u.id)) AS warned
      FROM users u LEFT JOIN business_profiles bp ON bp.user_id = u.id LEFT JOIN ngos n ON n.user_id = u.id LEFT JOIN admins a ON a.user_id = u.id
      WHERE u.role IN (${['admin', ...BUSINESS_ROLES, 'ngo'].map(() => '?').join(', ')})`, ['admin', ...BUSINESS_ROLES, 'ngo']);
    return rows[0];
  },
  async details(userId) {
    const [rows] = await pool.execute(`${baseSelect} WHERE u.id = ? AND u.role IN (${['admin', ...BUSINESS_ROLES, 'ngo'].map(() => '?').join(', ')}) LIMIT 1`, [userId, 'admin', ...BUSINESS_ROLES, 'ngo']);
    const account = rows[0];
    if (!account) return null;
    const [warnings] = await pool.execute(`SELECT w.id, w.category, w.reason, w.severity, w.status, w.created_at, w.related_donation_id, u.full_name AS admin_name
      FROM account_warnings w LEFT JOIN users u ON u.id = w.issued_by_user_id WHERE w.target_user_id = ? ORDER BY w.created_at DESC LIMIT 50`, [userId]);
    const [history] = await pool.execute(`SELECT action, details_json, created_at FROM activity_logs WHERE entity_type = 'account' AND entity_id = ? ORDER BY created_at DESC LIMIT 50`, [userId]);
    let donations = [];
    if (BUSINESS_ROLES.includes(account.role)) {
      [donations] = await pool.execute(`SELECT d.id, d.food_name, d.quantity, d.status, d.created_at, d.expiry_time,
        n.ngo_name, c.name AS category_name FROM donations d LEFT JOIN accepted_donations ad ON ad.donation_id = d.id
        LEFT JOIN ngos n ON n.id = ad.ngo_id LEFT JOIN food_categories c ON c.id = d.category_id
        WHERE d.business_user_id = ? ORDER BY d.created_at DESC LIMIT 100`, [userId]);
    }
    if (account.role === 'ngo') {
      [donations] = await pool.execute(`SELECT d.id, d.food_name, d.quantity, ad.status, ad.accepted_at AS created_at, d.expiry_time,
        u.business_name, c.name AS category_name FROM accepted_donations ad JOIN donations d ON d.id = ad.donation_id
        JOIN ngos n ON n.id = ad.ngo_id JOIN users u ON u.id = d.business_user_id LEFT JOIN food_categories c ON c.id = d.category_id
        WHERE n.user_id = ? ORDER BY ad.accepted_at DESC LIMIT 100`, [userId]);
    }
    return { ...account, warnings, history, donations };
  },
  donorRoleSlots
};
