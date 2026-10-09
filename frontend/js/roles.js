// Canonical frontend mapping for roles persisted by the Food Rescue API.
export const BUSINESS_ROLES = Object.freeze(['restaurant', 'hotel', 'bakery', 'supermarket', 'catering', 'marriage_hall', 'business', 'donor']);
export const DASHBOARD_BY_ROLE = Object.freeze({
  admin: '/admin/dashboard.html',
  ngo: '/ngo/dashboard.html',
  business: '/business/dashboard.html',
  donor: '/business/dashboard.html',
  restaurant: '/business/dashboard.html',
  hotel: '/business/dashboard.html',
  bakery: '/business/dashboard.html',
  supermarket: '/business/dashboard.html',
  catering: '/business/dashboard.html',
  marriage_hall: '/business/dashboard.html'
});

export const dashboardForRole = role => {
  const target = DASHBOARD_BY_ROLE[String(role || '').toLowerCase()] || '/index.html';
  if (typeof window !== 'undefined' && window.location.pathname.includes('/frontend/')) {
    return target.startsWith('/frontend/') ? target : '/frontend' + target;
  }
  return target;
};
