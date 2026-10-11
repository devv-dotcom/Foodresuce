const pool = require('../config/database');
const { BUSINESS_ROLES } = require('../config/roles');

const donorRoleSlots = BUSINESS_ROLES.map(() => '?').join(', ');
const roleFilter = role => role === 'donor' ? { sql: `u.role IN (${donorRoleSlots})`, values: BUSINESS_ROLES } : role === 'ngo' || role === 'admin' ? { sql: 'u.role = ?', values: [role] } : null;
const statusSql = `COALESCE(NULLIF(u.account_status, 'active'), bp.account_status, n.account_status, a.account_status, 'active')`;
const listJoins = `FROM users u
  LEFT JOIN business_profiles bp ON bp.user_id = u.id
  LEFT JOIN ngos n ON n.user_id = u.id
  LEFT JOIN ngo_profiles np ON np.ngo_id = n.id
  LEFT JOIN admins a ON a.user_id = u.id`;
const baseSelect = `SELECT u.id, u.full_name, u.email, u.mobile, u.role, COALESCE(bp.business_name, u.business_name) AS business_name, u.address, u.city, u.state, u.pincode,
  u.is_verified, u.account_status AS user_status, u.created_at, u.updated_at,
  bp.account_status AS donor_status, n.account_status AS ngo_status, n.ngo_name, n.registration_number,
  np.mission AS ngo_mission, np.service_area AS ngo_service_area,
  a.account_status AS admin_status, a.last_login_at,
  ${statusSql} AS account_status,
  (SELECT COUNT(*) FROM donations d WHERE d.business_user_id = u.id) AS donation_count,
  (SELECT COUNT(*) FROM accepted_donations ad WHERE ad.ngo_id = n.id AND ad.status <> 'cancelled') AS ngo_claimed_count,
  (SELECT COUNT(*) FROM account_warnings w WHERE w.target_user_id = u.id) AS warning_count,
  (SELECT MAX(l.created_at) FROM activity_logs l WHERE l.entity_type = 'account' AND l.entity_id = u.id) AS last_account_activity
  ${listJoins}`;
const accountListSelect = `SELECT u.id, u.full_name, u.email, u.mobile, u.role, COALESCE(bp.business_name, u.business_name) AS business_name, u.city, u.state,
  u.is_verified, u.created_at, n.ngo_name, n.registration_number, ${statusSql} AS account_status,
  (SELECT COUNT(*) FROM donations d WHERE d.business_user_id = u.id AND d.deleted_at IS NULL) AS donation_count,
  (SELECT COUNT(*) FROM accepted_donations ad WHERE ad.ngo_id = n.id AND ad.status <> 'cancelled') AS ngo_claimed_count,
  (SELECT COUNT(*) FROM account_warnings w WHERE w.target_user_id = u.id) AS warning_count
  ${listJoins}`;

const directoryWhere = ({ role, q, status, category, verified, warned, from, to }) => {
  const conditions = [];
  const values = [];
  if (role === 'donor') {
    conditions.push(`u.role IN (${donorRoleSlots})`);
    values.push(...BUSINESS_ROLES);
    if (category && BUSINESS_ROLES.includes(category)) { conditions.push('u.role = ?'); values.push(category); }
  } else {
    conditions.push("u.role = 'ngo'");
  }
  conditions.push(`${statusSql} <> 'deleted'`);
  if (q) {
    const term = `%${q}%`;
    conditions.push('(u.full_name LIKE ? OR u.email LIKE ? OR u.mobile LIKE ? OR u.business_name LIKE ? OR bp.business_name LIKE ? OR n.ngo_name LIKE ? OR u.city LIKE ? OR CAST(u.id AS CHAR) = ?)');
    values.push(term, term, term, term, term, term, term, q);
  }
  if (status) { conditions.push(`${statusSql} = ?`); values.push(status); }
  if (verified === 'true') conditions.push('u.is_verified = TRUE');
  if (verified === 'false') conditions.push('u.is_verified = FALSE');
  if (warned === 'true') conditions.push('EXISTS (SELECT 1 FROM account_warnings w WHERE w.target_user_id = u.id)');
  if (warned === 'false') conditions.push('NOT EXISTS (SELECT 1 FROM account_warnings w WHERE w.target_user_id = u.id)');
  if (from) { conditions.push('u.created_at >= ?'); values.push(`${from} 00:00:00`); }
  if (to) { conditions.push('u.created_at < DATE_ADD(?, INTERVAL 1 DAY)'); values.push(to); }
  return { where: `WHERE ${conditions.join(' AND ')}`, values };
};

const directorySortSql = (sort, direction, role) => {
  const columns = {
    created: 'u.created_at',
    name: role === 'ngo' ? 'COALESCE(n.ngo_name, u.full_name)' : 'COALESCE(bp.business_name, u.business_name, u.full_name)',
    email: 'u.email',
    donations: role === 'ngo'
      ? '(SELECT COUNT(*) FROM accepted_donations ad WHERE ad.ngo_id = n.id AND ad.status <> \'cancelled\')'
      : '(SELECT COUNT(*) FROM donations d WHERE d.business_user_id = u.id AND d.deleted_at IS NULL)'
  };
  return `${columns[sort] || columns.created} ${direction === 'asc' ? 'ASC' : 'DESC'}, u.id ASC`;
};

module.exports = {
  async list({ q, role, status, category, directoryOnly, verified, warned, from, to, limit, offset, sort = 'created', direction = 'desc' }) {
    const conditions = [];
    const values = [];
    const roles = roleFilter(role);
    if (role && roles) { conditions.push(roles.sql); values.push(...roles.values); }
    else if (role === 'donor') { conditions.push(roles.sql); values.push(...roles.values); }
    else conditions.push(`u.role IN (${['admin', ...BUSINESS_ROLES, 'ngo'].map(() => '?').join(', ')})`), values.push('admin', ...BUSINESS_ROLES, 'ngo');
    if (directoryOnly) conditions.push(`${statusSql} <> 'deleted'`);
    if (q) { conditions.push('(u.full_name LIKE ? OR u.email LIKE ? OR u.mobile LIKE ? OR u.city LIKE ? OR u.business_name LIKE ? OR bp.business_name LIKE ? OR n.ngo_name LIKE ? OR CAST(u.id AS CHAR) = ?)'); const term = `%${q}%`; values.push(term, term, term, term, term, term, term, q); }
    if (status) { conditions.push(`${statusSql} = ?`); values.push(status); }
    if (role === 'donor' && category && BUSINESS_ROLES.includes(category)) { conditions.push('u.role = ?'); values.push(category); }
    if (verified === 'true') conditions.push('u.is_verified = TRUE');
    if (verified === 'false') conditions.push('u.is_verified = FALSE');
    if (warned === 'true') conditions.push('EXISTS (SELECT 1 FROM account_warnings w WHERE w.target_user_id = u.id)');
    if (warned === 'false') conditions.push('NOT EXISTS (SELECT 1 FROM account_warnings w WHERE w.target_user_id = u.id)');
    if (from) { conditions.push('u.created_at >= ?'); values.push(`${from} 00:00:00`); }
    if (to) { conditions.push('u.created_at < DATE_ADD(?, INTERVAL 1 DAY)'); values.push(to); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const order = directorySortSql(sort, direction, role === 'ngo' ? 'ngo' : 'donor');
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute(`${accountListSelect} ${where} ORDER BY ${order} LIMIT ${limit} OFFSET ${offset}`, values);
      const [[{ total }]] = await connection.execute(`SELECT COUNT(*) AS total ${listJoins} ${where}`, values);
      await connection.commit();
      return { rows, total: Number(total) };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  },
  streamDirectory({ role, q, status, category, verified, warned, from, to, sort = 'created', direction = 'desc' }) {
    const { where, values } = directoryWhere({ role, q, status, category, verified, warned, from, to });
    const order = directorySortSql(sort, direction, role);
    const sql = `SELECT u.id, COALESCE(n.ngo_name, bp.business_name, u.business_name, u.full_name) AS display_name,
      u.full_name AS contact_name, u.role AS category, u.email, u.mobile, u.city, u.state,
      u.is_verified, ${statusSql} AS account_status,
      (SELECT COUNT(*) FROM donations d WHERE d.business_user_id = u.id AND d.deleted_at IS NULL) AS donation_count,
      (SELECT COUNT(*) FROM accepted_donations ad WHERE ad.ngo_id = n.id AND ad.status <> 'cancelled') AS claimed_count,
      u.created_at ${listJoins} ${where} ORDER BY ${order}`;
    // The mysql2 promise wrapper returns promises from query(); its underlying
    // core pool exposes the row stream used here to keep export memory bounded.
    return pool.pool.query(sql, values).stream({ highWaterMark: 16 });
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
    const [history] = await pool.execute(`SELECT action, details_json, created_at FROM activity_logs
      WHERE entity_type = 'account' AND entity_id = ? AND action <> 'account_sensitive_view'
      ORDER BY created_at DESC LIMIT 50`, [userId]);
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
