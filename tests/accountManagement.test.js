const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../config/database');
const controller = require('../controllers/accountManagementController');

const response = () => ({ statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; } });
const request = (overrides = {}) => ({ params: { id: '24' }, body: {}, user: { id: 7 }, admin: { admin_id: 3 }, ip: '127.0.0.1', ...overrides });
const transaction = execute => {
  const calls = [];
  const connection = {
    async beginTransaction() { calls.push(['begin']); },
    async commit() { calls.push(['commit']); },
    async rollback() { calls.push(['rollback']); },
    release() { calls.push(['release']); },
    async execute(sql, values) { calls.push([sql, values]); return execute(sql, values); }
  };
  return { connection, calls };
};

test('account anonymization requires an exact identifier and reason before opening a transaction', async () => {
  const original = pool.getConnection;
  let connected = false;
  pool.getConnection = async () => { connected = true; throw new Error('should not connect'); };
  try {
    const res = response();
    await controller.remove(request({ body: { confirmIdentifier: '25', reason: 'Privacy request' } }), res, assert.fail);
    assert.equal(res.statusCode, 422);
    assert.equal(connected, false);
  } finally { pool.getConnection = original; }
});

test('anonymization clears donor profile details, revokes tokens, and keeps the user row', async () => {
  const original = pool.getConnection;
  const tx = transaction(async sql => {
    if (sql.startsWith('SELECT id, role, account_status')) return [[{ id: 24, role: 'restaurant', account_status: 'active' }]];
    return [{ affectedRows: 1 }];
  });
  pool.getConnection = async () => tx.connection;
  try {
    const res = response();
    await controller.remove(request({ body: { confirmIdentifier: '24', deletionReason: 'user_request', reason: 'Account owner requested removal' } }), res, assert.fail);
    const update = tx.calls.find(([sql]) => typeof sql === 'string' && sql.startsWith('UPDATE users SET full_name'));
    assert.ok(update);
    assert.match(update[0], /account_status = 'deleted', token_version = token_version \+ 1/);
    assert.ok(tx.calls.some(([sql]) => typeof sql === 'string' && sql.startsWith('UPDATE business_profiles SET business_name')));
    assert.ok(tx.calls.some(([sql]) => typeof sql === 'string' && sql.startsWith('DELETE FROM business_images')));
    assert.ok(tx.calls.some(([sql]) => typeof sql === 'string' && sql.startsWith('UPDATE activity_logs SET details_json = JSON_SET')));
    assert.ok(tx.calls.some(([sql]) => typeof sql === 'string' && sql.includes("'account'")));
    assert.equal(res.statusCode, 200);
    assert.match(res.body.message, /history preserved/);
    assert.ok(tx.calls.some(([name]) => name === 'commit'));
  } finally { pool.getConnection = original; }
});

test('administrator cannot suspend their own account', async () => {
  const original = pool.getConnection;
  pool.getConnection = async () => { throw new Error('should not connect'); };
  try {
    const res = response();
    await controller.setStatus(request({ user: { id: 24 }, body: { status: 'suspended', reason: 'Temporary access restriction' } }), res, assert.fail);
    assert.equal(res.statusCode, 409);
    assert.match(res.body.message, /cannot suspend your own/);
  } finally { pool.getConnection = original; }
});

test('suspending a donor blocks access and advances the session token version', async () => {
  const original = pool.getConnection;
  const tx = transaction(async sql => {
    if (sql.startsWith('SELECT u.id, u.role')) return [[{ id: 24, role: 'restaurant', account_status: 'active' }]];
    return [{ affectedRows: 1 }];
  });
  pool.getConnection = async () => tx.connection;
  try {
    const res = response();
    await controller.setStatus(request({ body: { status: 'suspended', reason: 'Repeated pickup failures' } }), res, assert.fail);
    const sessionUpdate = tx.calls.find(([sql]) => typeof sql === 'string' && sql.startsWith('UPDATE users SET account_status'));
    assert.match(sessionUpdate[0], /token_version = token_version \+ 1/);
    assert.ok(tx.calls.some(([sql]) => typeof sql === 'string' && sql.startsWith('UPDATE business_profiles')));
    assert.equal(res.statusCode, 200);
  } finally { pool.getConnection = original; }
});

test('the last active administrator cannot be suspended', async () => {
  const original = pool.getConnection;
  const tx = transaction(async sql => {
    if (sql.startsWith('SELECT u.id, u.role')) return [[{ id: 24, role: 'admin', account_status: 'active' }]];
    if (sql.startsWith('SELECT COUNT(*) AS activeAdmins')) return [[{ activeAdmins: 1 }]];
    return [[], []];
  });
  pool.getConnection = async () => tx.connection;
  try {
    const res = response();
    await controller.setStatus(request({ body: { status: 'suspended', reason: 'Repeated policy violations' } }), res, assert.fail);
    assert.equal(res.statusCode, 409);
    assert.match(res.body.message, /last active administrator/);
    assert.ok(tx.calls.some(([name]) => name === 'rollback'));
  } finally { pool.getConnection = original; }
});

test('formal warning validates category and reason before writing', async () => {
  const original = pool.getConnection;
  pool.getConnection = async () => { throw new Error('should not connect'); };
  try {
    const res = response();
    await controller.warn(request({ body: { category: 'other', severity: 'high', reason: 'Too short' } }), res, assert.fail);
    assert.equal(res.statusCode, 422);
    assert.match(res.body.message, /10–3000 characters/);
  } finally { pool.getConnection = original; }
});

test('formal warning writes an account warning, user notification, and audit record atomically', async () => {
  const original = pool.getConnection;
  const tx = transaction(async sql => {
    if (sql.startsWith('SELECT id, role, account_status')) return [[{ id: 24, role: 'restaurant', account_status: 'active' }]];
    if (sql.startsWith('INSERT INTO account_warnings')) return [{ insertId: 88 }];
    return [{ affectedRows: 1 }];
  });
  pool.getConnection = async () => tx.connection;
  try {
    const res = response();
    await controller.warn(request({ body: { category: 'missed_pickup', severity: 'medium', reason: 'The donor missed two confirmed collection windows.' } }), res, assert.fail);
    assert.ok(tx.calls.some(([sql]) => typeof sql === 'string' && sql.startsWith('INSERT INTO account_warnings')));
    assert.ok(tx.calls.some(([sql]) => typeof sql === 'string' && sql.startsWith('INSERT INTO notifications')));
    assert.ok(tx.calls.some(([sql]) => typeof sql === 'string' && sql.includes("'account'")));
    assert.equal(res.statusCode, 201);
    assert.equal(res.body.warningId, 88);
    assert.ok(tx.calls.some(([name]) => name === 'commit'));
  } finally { pool.getConnection = original; }
});
