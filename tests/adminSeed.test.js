'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcrypt');
const pool = require('../config/database');
const { seedAdminAccount } = require('../services/adminSeed');

const withBootstrapEnv = async run => {
  const previous = { ADMIN_EMAIL: process.env.ADMIN_EMAIL, ADMIN_PASSWORD: process.env.ADMIN_PASSWORD };
  process.env.ADMIN_EMAIL = 'food-rescue-admin@example.test';
  process.env.ADMIN_PASSWORD = 'a-long-bootstrap-secret-for-tests';
  try { await run(); }
  finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
};

test('admin provisioning refuses to promote an existing donor or NGO email', async () => {
  await withBootstrapEnv(async () => {
    const originalGetConnection = pool.getConnection;
    let committed = false;
    let rolledBack = false;
    let executed = 0;
    pool.getConnection = async () => ({
      beginTransaction: async () => {},
      execute: async () => { executed += 1; return [[{ id: 7, role: 'ngo' }]]; },
      commit: async () => { committed = true; },
      rollback: async () => { rolledBack = true; },
      release: () => {}
    });
    try {
      await assert.rejects(seedAdminAccount(), error => error.code === 'ADMIN_EMAIL_ROLE_CONFLICT');
      assert.equal(executed, 1);
      assert.equal(committed, false);
      assert.equal(rolledBack, true);
    } finally { pool.getConnection = originalGetConnection; }
  });
});

test('admin provisioning updates the configured bcrypt credential without reactivating a disabled account', async () => {
  await withBootstrapEnv(async () => {
    const originalGetConnection = pool.getConnection;
    const statements = [];
    let committed = false;
    pool.getConnection = async () => ({
      beginTransaction: async () => {},
      execute: async (sql, values) => {
        statements.push({ sql, values });
        if (sql.startsWith('SELECT id, role FROM users')) return [[{ id: 7, role: 'admin' }]];
        if (sql.startsWith('SELECT id FROM admins')) return [[{ id: 9 }]];
        return [{ affectedRows: 1 }];
      },
      commit: async () => { committed = true; },
      rollback: async () => {},
      release: () => {}
    });
    try {
      assert.equal(await seedAdminAccount(), true);
      assert.equal(committed, true);
      const userUpdate = statements.find(({ sql }) => sql.startsWith('UPDATE users SET password'));
      assert.ok(userUpdate);
      assert.equal(await bcrypt.compare(process.env.ADMIN_PASSWORD, userUpdate.values[0]), true);
      assert.equal(statements.some(({ sql }) => sql.startsWith('UPDATE admins SET account_status')), false);
    } finally { pool.getConnection = originalGetConnection; }
  });
});
