'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { HANDOFF_CODE_LENGTH, createHandoffCode, hashHandoffCode, isValidHandoffCode } = require('../utils/handoffCode');

test('generates an 8-character handoff code using unambiguous characters', () => {
  const code = createHandoffCode();
  assert.equal(code.length, HANDOFF_CODE_LENGTH);
  assert.equal(isValidHandoffCode(code), true);
  assert.match(code, /^[A-HJ-NP-Z2-9]{8}$/);
});

test('normalizes handoff-code input consistently for verification', () => {
  assert.equal(hashHandoffCode('ab3cdefg'), hashHandoffCode('AB3CDEFG'));
  assert.equal(isValidHandoffCode(' ab3cdefg '), true);
  assert.equal(isValidHandoffCode('AB0CDEFG'), false);
  assert.equal(isValidHandoffCode('AB3CDE'), false);
});
