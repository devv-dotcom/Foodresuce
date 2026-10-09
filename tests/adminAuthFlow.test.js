'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const Admin = require('../models/Admin');
const ActivityLog = require('../models/ActivityLog');
const User = require('../models/User');
const adminController = require('../controllers/adminController');
const { authenticate, authorizeRoles } = require('../middleware/auth');
const { requireActiveAdmin } = require('../middleware/adminAuth');

const responseHarness = () => ({
  statusCode: 200,
  body: null,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; }
});

test('admin login verifies bcrypt, issues an admin JWT, and reports safe failure states', async () => {
  const env = { ADMIN_EMAIL: process.env.ADMIN_EMAIL, ADMIN_PASSWORD: process.env.ADMIN_PASSWORD, JWT_SECRET: process.env.JWT_SECRET };
  const originals = {
    findByEmail: Admin.findByEmail,
    updateLastLogin: Admin.updateLastLogin,
    createActivity: ActivityLog.create
  };
  const password = 'test-admin-password-2026';
  const passwordHash = await bcrypt.hash(password, 4);
  process.env.ADMIN_EMAIL = 'food-rescue-admin@example.test';
  process.env.ADMIN_PASSWORD = 'configured-bootstrap-password';
  process.env.JWT_SECRET = 'admin-auth-flow-test-secret';
  Admin.findByEmail = async () => ({ admin_id: 12, id: 41, full_name: 'Test Admin', email: process.env.ADMIN_EMAIL, role: 'admin', account_status: 'active', password: passwordHash });
  Admin.updateLastLogin = async () => {};
  ActivityLog.create = async () => {};

  const invokeLogin = async credentials => {
    const res = responseHarness();
    await adminController.login({ body: credentials, ip: '127.0.0.1' }, res, error => { throw error; });
    return res;
  };

  try {
    const valid = await invokeLogin({ email: process.env.ADMIN_EMAIL, password });
    assert.equal(valid.statusCode, 200);
    assert.equal(valid.body.user.role, 'admin');
    assert.equal(jwt.verify(valid.body.token, process.env.JWT_SECRET).role, 'admin');

    const invalid = await invokeLogin({ email: process.env.ADMIN_EMAIL, password: 'incorrect-password' });
    assert.equal(invalid.statusCode, 401);
    assert.equal(invalid.body.success, false);

    Admin.findByEmail = async () => null;
    const missing = await invokeLogin({ email: process.env.ADMIN_EMAIL, password });
    assert.equal(missing.statusCode, 503);
    assert.match(missing.body.message, /npm run admin:setup/);

    Admin.findByEmail = async () => ({ admin_id: 12, id: 41, full_name: 'Test Admin', email: process.env.ADMIN_EMAIL, role: 'admin', account_status: 'suspended', password: passwordHash });
    const inactive = await invokeLogin({ email: process.env.ADMIN_EMAIL, password });
    assert.equal(inactive.statusCode, 403);
  } finally {
    Admin.findByEmail = originals.findByEmail;
    Admin.updateLastLogin = originals.updateLastLogin;
    ActivityLog.create = originals.createActivity;
    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('database lookup failures during token authentication remain server errors, not expired sessions', async () => {
  const originalFindById = User.findPublicById;
  const previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'admin-auth-flow-test-secret';
  User.findPublicById = async () => { const error = new Error('database unavailable'); error.code = 'EACCES'; throw error; };
  const token = jwt.sign({ sub: 41, role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '5m' });
  const req = { headers: { authorization: `Bearer ${token}` } };
  const res = responseHarness();
  let passedError;
  try {
    await authenticate(req, res, error => { passedError = error; });
    assert.equal(res.statusCode, 200);
    assert.equal(passedError?.code, 'EACCES');
  } finally {
    User.findPublicById = originalFindById;
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
  }
});

test('donor and NGO bearer sessions still authenticate through the shared middleware', async () => {
  const originalFindById = User.findPublicById;
  const previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'admin-auth-flow-test-secret';
  try {
    for (const user of [
      { id: 56, role: 'restaurant' },
      { id: 57, role: 'ngo' }
    ]) {
      User.findPublicById = async id => Number(id) === user.id ? user : null;
      const token = jwt.sign({ sub: user.id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '5m' });
      const req = { headers: { authorization: `Bearer ${token}` } };
      const res = responseHarness();
      let continued = false;
      await authenticate(req, res, error => { if (error) throw error; continued = true; });
      assert.equal(continued, true);
      assert.equal(req.user.role, user.role);
    }
  } finally {
    User.findPublicById = originalFindById;
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
  }
});

test('admin middleware enforces the account row and rejects a donor role', async () => {
  const previousEmail = process.env.ADMIN_EMAIL;
  process.env.ADMIN_EMAIL = 'food-rescue-admin@example.test';
  const originalFindByUserId = Admin.findByUserId;
  Admin.findByUserId = async () => ({ admin_id: 12, id: 41, email: process.env.ADMIN_EMAIL, account_status: 'active' });
  try {
    const req = { user: { id: 41, role: 'admin' } };
    const res = responseHarness();
    let continued = false;
    await requireActiveAdmin(req, res, error => { if (error) throw error; continued = true; });
    assert.equal(continued, true);
    assert.equal(req.admin.admin_id, 12);

    const donorReq = { user: { id: 55, role: 'restaurant' } };
    const donorRes = responseHarness();
    authorizeRoles('admin')(donorReq, donorRes, () => assert.fail('donor must not pass the admin role gate'));
    assert.equal(donorRes.statusCode, 403);
  } finally {
    Admin.findByUserId = originalFindByUserId;
    if (previousEmail === undefined) delete process.env.ADMIN_EMAIL;
    else process.env.ADMIN_EMAIL = previousEmail;
  }
});
