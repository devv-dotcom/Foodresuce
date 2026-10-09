'use strict';

// Keep a single bootstrap administrator address for deployments that omit
// ADMIN_EMAIL. The password remains deployment-only and is never defaulted.
const DEFAULT_ADMIN_EMAIL = 'admin.org@gmail.com';

function getAdminEmail() {
  const configuredEmail = String(process.env.ADMIN_EMAIL || '').trim();
  return (configuredEmail || DEFAULT_ADMIN_EMAIL).toLowerCase();
}

module.exports = { DEFAULT_ADMIN_EMAIL, getAdminEmail };
