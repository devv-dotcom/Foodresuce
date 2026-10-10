const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const migration = fs.readFileSync(path.join(__dirname, '..', 'database', 'autoMigrate.js'), 'utf8');

test('startup migration activates pending accounts without clearing rejection or suspension', () => {
  assert.match(migration, /UPDATE ngos SET account_status = 'active' WHERE account_status = 'pending'/);
  assert.match(migration, /UPDATE business_profiles SET account_status = 'active' WHERE account_status = 'pending'/);
  assert.doesNotMatch(migration, /UPDATE (?:ngos|business_profiles) SET account_status = 'active' WHERE account_status <> 'active'/);
});
