const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateDistance, resolveCoordinates } = require('../services/geoService');

test('calculates distance between valid coordinate pairs including the equator and prime meridian', () => {
  assert.equal(calculateDistance(0, 0, 0, 1), 111.2);
  assert.equal(calculateDistance(0, 0, 0, 0), 0);
});

test('rejects invalid geographic coordinates rather than returning misleading distances', () => {
  assert.equal(calculateDistance(91, 0, 0, 0), null);
  assert.equal(calculateDistance(0, 181, 0, 0), null);
  assert.equal(calculateDistance(Number.NaN, 0, 0, 0), null);
  assert.equal(calculateDistance(null, null, 0, 0), null);
});

test('preserves valid zero-valued coordinates when resolving explicit locations', () => {
  assert.deepEqual(resolveCoordinates({ latitude: 0, longitude: 0 }), { latitude: 0, longitude: 0 });
});
