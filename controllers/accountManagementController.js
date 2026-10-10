const pool = require('../config/database');
const Account = require('../models/AccountManagement');
const { BUSINESS_ROLES } = require('../config/roles');

const validId = value => /^\d{1,16}$/.test(String(value || '')) && Number.isSafeInteger(Number(value)) && Number(value) > 0;
const page = query => ({ limit: Math.min(Math.max(Number(query.limit) || 25, 1), 100), offset: Math.max(Number(query.offset) || 0, 0) });
const donorRoles = BUSINESS_ROLES;
const isDonor = role => donorRoles.includes(role);
const audit = (connection, req, action, userId, details = {}) => connection.execute(
  'INSERT INTO activity_logs (actor_user_id, action, entity_type, entity_id, details_json, ip_address) VALUES (?, ?, \'account\', ?, ?, ?)',
  [req.user.id, action, userId, JSON.stringify(details), req.ip]
);
const normalized = value => String(value ?? '').trim();

exports.list = async (req, res, next) => {
  try {
    const { limit, offset } = page(req.query);
    const role = ['admin', 'ngo', 'donor'].includes(req.query.role) ? req.query.role : null;
    const status = ['active', 'pending', 'suspended', 'deleted', 'rejected'].includes(req.query.status) ? req.query.status : null;
    const from = /^\d{4}-\d{2}-\d{2}$/.test(req.query.from || '') ? req.query.from : null;
    const to = /^\d{4}-\d{2}-\d{2}$/.test(req.query.to || '') ? req.query.to : null;
    const result = await Account.list({ q: normalized(req.query.q).slice(0, 100), role, status, verified: req.query.verified, warned: req.query.warned, from, to, limit, offset });
    return res.json({ success: true, accounts: result.rows, total: result.total, limit, offset, summary: await Account.summary() });
  } catch (error) { next(error); }
};

exports.details = async (req, res, next) => {
  if (!validId(req.params.id)) return res.status(400).json({ success: false, message: 'A valid account ID is required.' });
  let connection;
  try {
    connection = await pool.getConnection();
    const account = await Account.details(req.params.id);
    if (!account) return res.status(404).json({ success: false, message: 'Account not found.' });
    await audit(connection, req, 'account_sensitive_view', Number(req.params.id), { role: account.role });
    return res.json({ success: true, account });
  } catch (error) { next(error); } finally { connection?.release(); }
};

exports.update = async (req, res, next) => {
  if (!validId(req.params.id)) return res.status(400).json({ success: false, message: 'A valid account ID is required.' });
  const id = Number(req.params.id);
  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [rows] = await connection.execute(`SELECT u.id, u.role, u.full_name, u.email, u.mobile, u.business_name, u.address, u.city, u.state, u.pincode,
      n.ngo_name, n.registration_number, n.id AS ngo_id FROM users u LEFT JOIN ngos n ON n.user_id = u.id WHERE u.id = ? FOR UPDATE`, [id]);
    const account = rows[0];
    if (!account || account.role === 'admin' || account.role === 'volunteer') { await connection.rollback(); return res.status(404).json({ success: false, message: 'Editable account not found.' }); }
    const fields = ['fullName', 'email', 'mobile', 'businessName', 'ngoName', 'registrationNumber', 'address', 'city', 'state', 'pincode'];
    if (!fields.some(key => Object.hasOwn(req.body, key))) { await connection.rollback(); return res.status(422).json({ success: false, message: 'Provide at least one editable profile field.' }); }
    const changes = {};
    for (const key of fields) if (Object.hasOwn(req.body, key)) changes[key] = normalized(req.body[key]);
    const fullName = changes.fullName ?? account.full_name;
    const email = Object.hasOwn(changes, 'email') ? changes.email.toLowerCase() : account.email;
    const mobile = changes.mobile ?? account.mobile;
    if (!fullName || fullName.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 255 || !/^[0-9+()\-\s]{10,20}$/.test(mobile)) {
      await connection.rollback(); return res.status(422).json({ success: false, message: 'Enter a valid name, email, and phone number.' });
    }
    const address = changes.address ?? account.address;
    const city = changes.city ?? account.city;
    const state = changes.state ?? account.state;
    const pincode = changes.pincode ?? account.pincode;
    const businessName = changes.businessName ?? account.business_name;
    const ngoNameValue = changes.ngoName ?? account.ngo_name;
    const registrationNumber = changes.registrationNumber ?? account.registration_number ?? '';
    if ((businessName && businessName.length > 160) || (ngoNameValue && ngoNameValue.length > 160) || registrationNumber.length > 100) {
      await connection.rollback(); return res.status(422).json({ success: false, message: 'Organization names must be 160 characters or fewer and registration numbers 100 characters or fewer.' });
    }
    if (!address || address.length > 255 || !city || city.length > 100 || !state || state.length > 100 || !/^[A-Za-z0-9\-\s]{4,12}$/.test(pincode)) {
      await connection.rollback(); return res.status(422).json({ success: false, message: 'Check the address, city, state, and postal code.' });
    }
    const [emailMatches] = await connection.execute('SELECT id FROM users WHERE LOWER(email) = LOWER(?) AND id <> ? LIMIT 1', [email, id]);
    if (emailMatches.length) { await connection.rollback(); return res.status(409).json({ success: false, message: 'That email address is already used by another account.' }); }
    const before = { full_name: account.full_name, email: account.email, mobile: account.mobile, business_name: account.business_name, ngo_name: account.ngo_name, registration_number: account.registration_number, address: account.address, city: account.city, state: account.state, pincode: account.pincode };
    await connection.execute('UPDATE users SET full_name = ?, email = ?, mobile = ?, business_name = ?, address = ?, city = ?, state = ?, pincode = ? WHERE id = ?', [fullName, email, mobile, businessName, address, city, state, pincode, id]);
    let needsReverification = false;
    if (account.ngo_id) {
      const ngoName = ngoNameValue;
      const registration = registrationNumber;
      needsReverification = ngoName !== account.ngo_name || registration !== (account.registration_number || '');
      await connection.execute('UPDATE ngos SET ngo_name = ?, registration_number = ?, account_status = IF(?, \'pending\', account_status) WHERE id = ?', [ngoName, registration || null, needsReverification, account.ngo_id]);
      if (needsReverification) {
        await connection.execute(`INSERT INTO notifications (created_by, recipient_user_id, target_role, title, message, notification_type)
          VALUES (?, ?, 'ngo', 'NGO details need verification', 'An administrator updated your organization details. Your account will be reviewed before normal access resumes.', 'verification_required')`, [req.admin.admin_id, id]);
      }
    }
    const after = { full_name: fullName, email, mobile, business_name: businessName, ngo_name: ngoNameValue, registration_number: registrationNumber || null, address, city, state, pincode };
    await audit(connection, req, 'account_edited', id, { before, after, reVerificationRequired: needsReverification });
    await connection.commit();
    return res.json({ success: true, message: needsReverification ? 'Account updated. NGO verification is pending review.' : 'Account updated successfully.', reVerificationRequired: needsReverification });
  } catch (error) { if (connection) await connection.rollback(); if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ success: false, message: 'That email or registration number is already in use.' }); next(error); }
  finally { connection?.release(); }
};

exports.setStatus = async (req, res, next) => {
  if (!validId(req.params.id)) return res.status(400).json({ success: false, message: 'A valid account ID is required.' });
  const id = Number(req.params.id);
  const status = req.body.status;
  const reason = normalized(req.body.reason);
  if (!['active', 'suspended'].includes(status) || reason.length < 3 || reason.length > 1000) return res.status(422).json({ success: false, message: 'Choose active or suspended and provide a reason.' });
  if (id === Number(req.user.id)) return res.status(409).json({ success: false, message: 'You cannot suspend your own administrator account.' });
  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [rows] = await connection.execute(`SELECT u.id, u.role, COALESCE(NULLIF(u.account_status, 'active'), bp.account_status, n.account_status, a.account_status, 'active') AS account_status
      FROM users u LEFT JOIN business_profiles bp ON bp.user_id = u.id LEFT JOIN ngos n ON n.user_id = u.id LEFT JOIN admins a ON a.user_id = u.id WHERE u.id = ? FOR UPDATE`, [id]);
    if (!rows[0] || rows[0].role === 'volunteer') { await connection.rollback(); return res.status(404).json({ success: false, message: 'Account not found.' }); }
    if (status === 'suspended' && rows[0].account_status !== 'active') { await connection.rollback(); return res.status(409).json({ success: false, message: 'Only active accounts can be suspended. Pending or rejected accounts must use the verification workflow.' }); }
    if (status === 'active' && rows[0].account_status !== 'suspended') { await connection.rollback(); return res.status(409).json({ success: false, message: 'Only suspended accounts can be restored. Pending or rejected accounts must complete the verification workflow.' }); }
    if (rows[0].role === 'admin' && status === 'suspended') {
      await connection.execute('SELECT a.id FROM admins a JOIN users u ON u.id = a.user_id WHERE a.account_status = \'active\' AND u.account_status <> \'suspended\' FOR UPDATE');
      const [[{ activeAdmins }]] = await connection.execute("SELECT COUNT(*) AS activeAdmins FROM admins a JOIN users u ON u.id = a.user_id WHERE a.account_status = 'active' AND u.account_status <> 'suspended'");
      if (Number(activeAdmins) <= 1) { await connection.rollback(); return res.status(409).json({ success: false, message: 'The last active administrator cannot be suspended.' }); }
    }
    await connection.execute('UPDATE users SET account_status = ?, token_version = token_version + 1 WHERE id = ?', [status, id]);
    if (isDonor(rows[0].role)) await connection.execute('UPDATE business_profiles SET account_status = ? WHERE user_id = ?', [status, id]);
    if (rows[0].role === 'ngo') await connection.execute('UPDATE ngos SET account_status = ? WHERE user_id = ?', [status, id]);
    if (rows[0].role === 'admin') await connection.execute('UPDATE admins SET account_status = ? WHERE user_id = ?', [status, id]);
    await audit(connection, req, status === 'suspended' ? 'account_suspended' : 'account_restored', id, { reason, previousStatus: rows[0].account_status || 'active', status });
    await connection.commit();
    return res.json({ success: true, message: status === 'suspended' ? 'Account suspended and sessions revoked.' : 'Account restored and previous sessions revoked.' });
  } catch (error) { if (connection) await connection.rollback(); next(error); } finally { connection?.release(); }
};

exports.remove = async (req, res, next) => {
  if (!validId(req.params.id)) return res.status(400).json({ success: false, message: 'A valid account ID is required.' });
  const id = Number(req.params.id);
  const reason = normalized(req.body.reason);
  const deletionReason = normalized(req.body.deletionReason);
  const allowedDeletionReasons = ['user_request', 'duplicate_account', 'policy_violation', 'fraud_or_abuse', 'inactive_account', 'other'];
  if (normalized(req.body.confirmIdentifier) !== String(id) || !allowedDeletionReasons.includes(deletionReason) || reason.length < 5 || reason.length > 1000) return res.status(422).json({ success: false, message: 'Confirm the account ID, choose a deletion reason, and provide details.' });
  if (id === Number(req.user.id)) return res.status(409).json({ success: false, message: 'You cannot delete your own administrator account.' });
  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [rows] = await connection.execute('SELECT id, role, account_status FROM users WHERE id = ? FOR UPDATE', [id]);
    if (!rows[0] || rows[0].role === 'admin' || rows[0].role === 'volunteer') { await connection.rollback(); return res.status(409).json({ success: false, message: 'Administrator or unavailable accounts cannot be deleted from this workspace.' }); }
    if (rows[0].account_status === 'deleted') { await connection.rollback(); return res.status(409).json({ success: false, message: 'This account has already been anonymized.' }); }
    const now = Date.now();
    await connection.execute(`UPDATE users SET full_name = ?, email = ?, mobile = '0000000000', business_name = NULL,
      address = '[Removed]', city = '[Removed]', state = '[Removed]', pincode = '0000', profile_image = NULL,
      account_status = 'deleted', token_version = token_version + 1 WHERE id = ?`, [`Deleted account ${id}`, `deleted+${id}.${now}@deleted.invalid`, id]);
    if (isDonor(rows[0].role)) {
      await connection.execute("UPDATE business_profiles SET business_name = '[Removed]' WHERE user_id = ?", [id]);
      await connection.execute('DELETE FROM business_images WHERE user_id = ?', [id]);
    }
    if (rows[0].role === 'ngo') {
      await connection.execute("UPDATE ngos SET ngo_name = '[Removed]', registration_number = NULL WHERE user_id = ?", [id]);
      await connection.execute('UPDATE ngo_profiles SET mission = NULL, service_area = NULL WHERE ngo_id = (SELECT id FROM ngos WHERE user_id = ?)', [id]);
    }
    await connection.execute(`UPDATE activity_logs SET details_json = JSON_SET(details_json,
      '$.before.full_name', '[Removed]', '$.after.full_name', '[Removed]',
      '$.before.email', '[Removed]', '$.after.email', '[Removed]',
      '$.before.mobile', '[Removed]', '$.after.mobile', '[Removed]',
      '$.before.business_name', '[Removed]', '$.after.business_name', '[Removed]',
      '$.before.ngo_name', '[Removed]', '$.after.ngo_name', '[Removed]',
      '$.before.registration_number', '[Removed]', '$.after.registration_number', '[Removed]',
      '$.before.address', '[Removed]', '$.after.address', '[Removed]',
      '$.before.city', '[Removed]', '$.after.city', '[Removed]',
      '$.before.state', '[Removed]', '$.after.state', '[Removed]',
      '$.before.pincode', '[Removed]', '$.after.pincode', '[Removed]')
      WHERE entity_type = 'account' AND entity_id = ? AND action = 'account_edited'`, [id]);
    await audit(connection, req, 'account_anonymized', id, { deletionReason, reason, method: 'soft_delete_anonymization' });
    await connection.commit();
    return res.json({ success: true, message: 'Account details were anonymized, sessions revoked, and transaction history preserved.' });
  } catch (error) { if (connection) await connection.rollback(); next(error); } finally { connection?.release(); }
};

exports.warn = async (req, res, next) => {
  if (!validId(req.params.id)) return res.status(400).json({ success: false, message: 'A valid account ID is required.' });
  const id = Number(req.params.id);
  const category = normalized(req.body.category);
  const severity = normalized(req.body.severity);
  const reason = normalized(req.body.reason);
  const categories = ['misleading_donation', 'repeated_cancellations', 'missed_pickup', 'food_safety_concern', 'platform_misuse', 'inappropriate_communication', 'policy_violation', 'other'];
  if (!categories.includes(category) || !['low', 'medium', 'high'].includes(severity) || reason.length < 10 || reason.length > 3000) return res.status(422).json({ success: false, message: 'Choose a warning category and severity, then enter a reason (10–3000 characters).' });
  const donationId = req.body.relatedDonationId ? Number(req.body.relatedDonationId) : null;
  if (donationId !== null && !Number.isSafeInteger(donationId)) return res.status(422).json({ success: false, message: 'Related donation ID is invalid.' });
  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [accounts] = await connection.execute('SELECT id, role, account_status FROM users WHERE id = ? FOR UPDATE', [id]);
    if (!accounts[0] || accounts[0].role === 'admin' || accounts[0].role === 'volunteer' || accounts[0].account_status === 'deleted') { await connection.rollback(); return res.status(404).json({ success: false, message: 'Donor or NGO account not found.' }); }
    if (donationId) {
      const [donations] = await connection.execute(`SELECT d.id FROM donations d LEFT JOIN ngos n ON n.user_id = ? LEFT JOIN accepted_donations ad ON ad.ngo_id = n.id AND ad.donation_id = d.id
        WHERE d.id = ? AND (d.business_user_id = ? OR ad.id IS NOT NULL) LIMIT 1`, [id, donationId, id]);
      if (!donations.length) { await connection.rollback(); return res.status(422).json({ success: false, message: 'The related donation is not associated with this account.' }); }
    }
    const [insert] = await connection.execute('INSERT INTO account_warnings (target_user_id, issued_by_user_id, category, reason, severity, related_donation_id) VALUES (?, ?, ?, ?, ?, ?)', [id, req.user.id, category, reason, severity, donationId]);
    await connection.execute(`INSERT INTO notifications (created_by, recipient_user_id, target_role, title, message, notification_type, related_donation_id)
      VALUES (?, ?, 'all', ?, ?, 'account_warning', ?)`, [req.admin.admin_id, id, 'A formal account warning was issued', reason, donationId]);
    await audit(connection, req, 'account_warning_issued', id, { warningId: insert.insertId, category, severity, relatedDonationId: donationId });
    await connection.commit();
    return res.status(201).json({ success: true, warningId: insert.insertId, message: 'Warning issued and an in-app notification was created.' });
  } catch (error) { if (connection) await connection.rollback(); next(error); } finally { connection?.release(); }
};
