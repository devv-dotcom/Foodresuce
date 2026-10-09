'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { isLoginOtpEnabled } = require('../config/authConfig');

test('keeps sign-in OTP paused unless explicitly enabled', () => {
  const previous = process.env.LOGIN_OTP_ENABLED;
  try {
    delete process.env.LOGIN_OTP_ENABLED;
    assert.equal(isLoginOtpEnabled(), false);
    process.env.LOGIN_OTP_ENABLED = 'false';
    assert.equal(isLoginOtpEnabled(), false);
    process.env.LOGIN_OTP_ENABLED = 'TRUE';
    assert.equal(isLoginOtpEnabled(), true);
  } finally {
    if (previous === undefined) delete process.env.LOGIN_OTP_ENABLED;
    else process.env.LOGIN_OTP_ENABLED = previous;
  }
});
