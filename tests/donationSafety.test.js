'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { donationWindowError, safetyDeclarationComplete } = require('../utils/donationSafety');

const validWindow = {
  preparationTime: '2026-10-09T16:00:00.000Z',
  pickupDateTime: '2026-10-09T18:00:00.000Z',
  expiryTime: '2026-10-09T20:00:00.000Z'
};

test('accepts an eligible pickup window', () => {
  assert.equal(donationWindowError(validWindow, Date.parse('2026-10-09T17:00:00.000Z')), null);
});

test('allows a pickup around midnight when it is before the deadline', () => {
  assert.equal(donationWindowError({
    preparationTime: '2026-10-09T20:00:00.000Z',
    pickupDateTime: '2026-10-10T00:30:00.000Z',
    expiryTime: '2026-10-10T02:00:00.000Z'
  }, Date.parse('2026-10-09T21:00:00.000Z')), null);
});

test('rejects expired donations and pickup beyond the deadline', () => {
  assert.match(donationWindowError(validWindow, Date.parse('2026-10-09T20:00:00.000Z')), /passed its listed collection deadline/);
  assert.match(donationWindowError({ ...validWindow, pickupDateTime: '2026-10-09T21:00:00.000Z' }, Date.parse('2026-10-09T17:00:00.000Z')), /Pickup time must fall/);
});

test('rejects preparation times in the future and invalid timestamps', () => {
  assert.match(donationWindowError({ ...validWindow, preparationTime: '2026-10-09T18:00:00.000Z' }, Date.parse('2026-10-09T17:00:00.000Z')), /cannot be in the future/);
  assert.match(donationWindowError({ ...validWindow, pickupDateTime: 'invalid' }, Date.parse('2026-10-09T17:00:00.000Z')), /Enter valid/);
});

test('requires all four explicit donor declarations', () => {
  const declarations = { safetyHygiene: 'true', safetyFreshness: 'true', safetyPackaging: 'true', safetyAccuracy: 'true' };
  assert.equal(safetyDeclarationComplete(declarations), true);
  assert.equal(safetyDeclarationComplete({ ...declarations, safetyAccuracy: 'false' }), false);
});
