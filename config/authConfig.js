'use strict';

// Keep sign-in OTP opt-in for local development, but require it in production
// unless the deployment explicitly disables it.
function isLoginOtpEnabled() {
  const configured = String(process.env.LOGIN_OTP_ENABLED || '').trim().toLowerCase();
  if (configured === 'true') return true;
  if (configured === 'false') return false;
  return String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production';
}

module.exports = { isLoginOtpEnabled };
