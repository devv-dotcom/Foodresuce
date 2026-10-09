'use strict';

// Sign-in OTP stays paused unless a deployment explicitly opts in.
function isLoginOtpEnabled() {
  return String(process.env.LOGIN_OTP_ENABLED || '').trim().toLowerCase() === 'true';
}

module.exports = { isLoginOtpEnabled };
