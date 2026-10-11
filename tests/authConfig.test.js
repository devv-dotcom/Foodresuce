'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { isLoginOtpEnabled } = require('../config/authConfig');

test('defaults sign-in OTP on in production and off elsewhere unless explicitly configured', () => {
  const previous = {
    loginOtp: process.env.LOGIN_OTP_ENABLED,
    nodeEnv: process.env.NODE_ENV
  };
  try {
    process.env.NODE_ENV = 'development';
    delete process.env.LOGIN_OTP_ENABLED;
    assert.equal(isLoginOtpEnabled(), false);

    process.env.NODE_ENV = 'production';
    assert.equal(isLoginOtpEnabled(), true);
    process.env.LOGIN_OTP_ENABLED = 'false';
    assert.equal(isLoginOtpEnabled(), false);
    process.env.LOGIN_OTP_ENABLED = '';
    assert.equal(isLoginOtpEnabled(), true);

    process.env.NODE_ENV = 'test';
    delete process.env.LOGIN_OTP_ENABLED;
    assert.equal(isLoginOtpEnabled(), false);
    process.env.LOGIN_OTP_ENABLED = 'false';
    assert.equal(isLoginOtpEnabled(), false);
    process.env.LOGIN_OTP_ENABLED = 'TRUE';
    assert.equal(isLoginOtpEnabled(), true);
  } finally {
    if (previous.loginOtp === undefined) delete process.env.LOGIN_OTP_ENABLED;
    else process.env.LOGIN_OTP_ENABLED = previous.loginOtp;
    if (previous.nodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous.nodeEnv;
  }
});
