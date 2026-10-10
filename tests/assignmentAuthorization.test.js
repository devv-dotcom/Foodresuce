'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../config/database');
const controller = require('../controllers/assignmentController');

test('assignment route guard scopes ID lookups to the authenticated NGO or admin', async () => {
  const originalExecute = pool.execute;
  const res = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
  let query;
  let values;
  pool.execute = async (sql, params) => {
    query = sql;
    values = params;
    return [[]];
  };
  try {
    let continued = false;
    await controller.authorizeAssignment({ params: { id: '91' }, user: { id: 24, role: 'ngo' } }, res, () => { continued = true; });
    assert.match(query, /a\.member_id = \?/);
    assert.match(query, /\? = 'admin'/);
    assert.deepEqual(values, ['91', 24, 'ngo']);
    assert.equal(res.statusCode, 404);
    assert.equal(continued, false);
  } finally {
    pool.execute = originalExecute;
  }
});

test('assignment authorization fails closed when the ownership lookup fails', async () => {
  const originalExecute = pool.execute;
  let calls = 0;
  const lookupError = Object.assign(new Error('database unavailable'), { code: 'ECONNREFUSED' });
  pool.execute = async () => { calls += 1; throw lookupError; };
  try {
    let passedError;
    await controller.authorizeAssignment({ params: { id: '91' }, user: { id: 24, role: 'ngo' } }, {}, error => { passedError = error; });
    assert.equal(passedError, lookupError);
    assert.equal(calls, 1);
  } finally {
    pool.execute = originalExecute;
  }
});
