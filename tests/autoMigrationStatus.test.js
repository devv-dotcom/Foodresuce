const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const migration = fs.readFileSync(path.join(__dirname, '..', 'database', 'autoMigrate.js'), 'utf8');
const legacyPatch = fs.readFileSync(path.join(__dirname, '..', 'database', 'patch_v2.sql'), 'utf8');

test('startup migration preserves existing account review statuses', () => {
  assert.match(migration, /ALTER TABLE ngos MODIFY COLUMN account_status ENUM\('active', 'pending', 'rejected', 'suspended'\)/);
  assert.match(migration, /ALTER TABLE business_profiles MODIFY COLUMN account_status ENUM\('active', 'suspended', 'pending', 'rejected'\)/);
  assert.doesNotMatch(migration, /UPDATE\s+(?:ngos|business_profiles)\s+SET\s+account_status/i);
  assert.match(legacyPatch, /MODIFY account_status ENUM\('active', 'suspended', 'pending', 'rejected'\)/);
  assert.doesNotMatch(legacyPatch, /UPDATE\s+(?:ngos|business_profiles)\s+SET\s+account_status/i);
});

test('startup migration adds a defaulted access-token version for session revocation', () => {
  assert.match(migration, /ensureColumn\('users', 'token_version', 'INT UNSIGNED NOT NULL DEFAULT 0'\)/);
});
