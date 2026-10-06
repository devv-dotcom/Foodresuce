// Canonical persisted user roles.  Keep this list in sync with the users.role
// database enum; aliases are deliberately not accepted as account roles.
const BUSINESS_ROLES = Object.freeze([
  'restaurant', 'hotel', 'bakery', 'supermarket', 'catering', 'marriage_hall'
]);
const ROLES = Object.freeze({
  ADMIN: 'admin',
  NGO: 'ngo',
  ...Object.freeze(Object.fromEntries(BUSINESS_ROLES.map(role => [role.toUpperCase(), role])))
});
const ALL_ROLES = Object.freeze([ROLES.ADMIN, ...BUSINESS_ROLES, ROLES.NGO]);

module.exports = { ROLES, ALL_ROLES, BUSINESS_ROLES };
