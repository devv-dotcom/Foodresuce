/**
 * Food Rescue Geographic Distance & Location Matching Service
 * Provides Haversine distance calculation, city/address fallback geocoding,
 * and database distance search utilities.
 */

const CITY_COORDINATES = {
  'hyderabad':     { lat: 17.385040, lng: 78.486671 },
  'secunderabad': { lat: 17.439930, lng: 78.498274 },
  'bangalore':    { lat: 12.971598, lng: 77.594566 },
  'bengaluru':    { lat: 12.971598, lng: 77.594566 },
  'mumbai':       { lat: 19.076090, lng: 72.877426 },
  'delhi':        { lat: 28.613939, lng: 77.209021 },
  'new delhi':    { lat: 28.613939, lng: 77.209021 },
  'chennai':      { lat: 13.082680, lng: 80.270718 },
  'pune':         { lat: 18.520430, lng: 73.856744 },
  'kolkata':      { lat: 22.572646, lng: 88.363895 },
  'ahmedabad':    { lat: 23.022505, lng: 72.571362 },
  'visakhapatnam':{ lat: 17.686816, lng: 83.218482 },
  'vijayawada':   { lat: 16.506174, lng: 80.648015 },
  'warangal':     { lat: 17.968901, lng: 79.594055 },
  'coimbatore':   { lat: 11.016844, lng: 76.955832 },
  'kochi':        { lat: 9.931233,  lng: 76.267304 },
  'trivandrum':   { lat: 8.524139,  lng: 76.936638 },
  'jaipur':       { lat: 26.912434, lng: 75.787271 },
  'surat':        { lat: 21.170240, lng: 72.831061 },
  'lucknow':      { lat: 26.846708, lng: 80.946159 }
};

/**
 * Calculate the great-circle distance between two points on Earth using the Haversine formula.
 * @param {number} lat1 
 * @param {number} lon1 
 * @param {number} lat2 
 * @param {number} lon2 
 * @returns {number} Distance in Kilometers rounded to 1 decimal place
 */
function calculateDistance(lat1, lon1, lat2, lon2) {
  if ([lat1, lon1, lat2, lon2].some(value => value === null || value === undefined || value === '')) return null;
  const nLat1 = Number(lat1);
  const nLon1 = Number(lon1);
  const nLat2 = Number(lat2);
  const nLon2 = Number(lon2);

  if (![nLat1, nLon1, nLat2, nLon2].every(Number.isFinite)
    || Math.abs(nLat1) > 90 || Math.abs(nLat2) > 90
    || Math.abs(nLon1) > 180 || Math.abs(nLon2) > 180) {
    return null;
  }

  const R = 6371; // Earth's radius in kilometers
  const dLat = (nLat2 - nLat1) * (Math.PI / 180);
  const dLon = (nLon2 - nLon1) * (Math.PI / 180);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(nLat1 * (Math.PI / 180)) *
    Math.cos(nLat2 * (Math.PI / 180)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);

  const boundedA = Math.min(1, Math.max(0, a));
  const c = 2 * Math.atan2(Math.sqrt(boundedA), Math.sqrt(1 - boundedA));
  const d = R * c;

  return Math.round(d * 10) / 10;
}

/**
 * Resolves location coordinates from explicit lat/lng or city name.
 * @param {Object} locationObj 
 * @returns {{ latitude: number|null, longitude: number|null }}
 */
function resolveCoordinates({ latitude, longitude, city, address }) {
  const hasExplicitCoordinates = latitude !== null && latitude !== undefined && latitude !== ''
    && longitude !== null && longitude !== undefined && longitude !== '';
  let lat = Number(latitude);
  let lng = Number(longitude);

  if (hasExplicitCoordinates && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
    return { latitude: Math.round(lat * 1000000) / 1000000, longitude: Math.round(lng * 1000000) / 1000000 };
  }

  const cleanCity = (city || '').trim().toLowerCase();
  if (cleanCity && CITY_COORDINATES[cleanCity]) {
    return { latitude: CITY_COORDINATES[cleanCity].lat, longitude: CITY_COORDINATES[cleanCity].lng };
  }

  // Check if city name is contained inside address string
  const cleanAddress = (address || '').toLowerCase();
  for (const [cityName, coords] of Object.entries(CITY_COORDINATES)) {
    if (cleanAddress.includes(cityName)) {
      return { latitude: coords.lat, longitude: coords.lng };
    }
  }

  return { latitude: null, longitude: null };
}

/**
 * Returns SQL snippet for Haversine distance in KM
 */
function getHaversineSql(latParam = '?', lngParam = '?') {
  return `(6371 * ACOS(LEAST(1.0, COS(RADIANS(${latParam})) * COS(RADIANS(u.latitude)) * COS(RADIANS(u.longitude) - RADIANS(${lngParam})) + SIN(RADIANS(${latParam})) * SIN(RADIANS(u.latitude)))))`;
}

module.exports = {
  calculateDistance,
  resolveCoordinates,
  getHaversineSql,
  CITY_COORDINATES
};
