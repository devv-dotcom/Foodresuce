'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULT_ADMIN_EMAIL, getAdminEmail } = require('../config/adminConfig');

test('uses the bootstrap administrator address when ADMIN_EMAIL is blank', () => {
  const previous = process.env.ADMIN_EMAIL;
  try {
    process.env.ADMIN_EMAIL = '   ';
    assert.equal(getAdminEmail(), DEFAULT_ADMIN_EMAIL);
  } finally {
    if (previous === undefined) delete process.env.ADMIN_EMAIL;
    else process.env.ADMIN_EMAIL = previous;
  }
});

test('normalizes the configured administrator address', () => {
  const previous = process.env.ADMIN_EMAIL;
  try {
    process.env.ADMIN_EMAIL = '  ADMIN@EXAMPLE.COM  ';
    assert.equal(getAdminEmail(), 'admin@example.com');
  } finally {
    if (previous === undefined) delete process.env.ADMIN_EMAIL;
    else process.env.ADMIN_EMAIL = previous;
  }
});
