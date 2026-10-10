'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const authController = require('../controllers/authController');

const responseHarness = () => ({
  statusCode: 200,
  body: null,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; }
});

test('password-reset token can update the password only once', async () => {
  const originalConsume = User.consumeOtpAndUpdatePassword;
  const previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'password-reset-replay-test-secret';
  let consumed = false;
  User.consumeOtpAndUpdatePassword = async (userId, otpHash) => {
    assert.equal(userId, 73);
    assert.match(otpHash, /^[a-f0-9]{64}$/);
    if (consumed) return false;
    consumed = true;
    return true;
  };
  const resetToken = jwt.sign({ sub: 73, purpose: 'password_reset', otp: 'a'.repeat(64) }, process.env.JWT_SECRET, { expiresIn: '5m' });
  const invoke = async () => {
    const res = responseHarness();
    await authController.resetPassword({ body: { resetToken, newPassword: 'new-secure-password' } }, res, error => { throw error; });
    return res;
  };

  try {
    const first = await invoke();
    const replay = await invoke();
    assert.equal(first.statusCode, 200);
    assert.equal(replay.statusCode, 400);
  } finally {
    User.consumeOtpAndUpdatePassword = originalConsume;
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
  }
});
