'use strict';

const urgencyLimits = () => ({
  medium: Number(process.env.RESCUE_MEDIUM_MINUTES) || 240,
  high: Number(process.env.RESCUE_HIGH_MINUTES) || 120,
  critical: Number(process.env.RESCUE_CRITICAL_MINUTES) || 60
});

const urgencyRank = Object.freeze({ critical: 0, high: 1, medium: 2, low: 3, expired: 4 });

const getUrgency = (expiryTime, now = Date.now()) => {
  const expiresAt = new Date(expiryTime).getTime();
  if (!Number.isFinite(expiresAt)) return { level: 'unknown', expiresInMinutes: null, rank: 5 };
  const expiresInMinutes = Math.ceil((expiresAt - now) / 60000);
  if (expiresInMinutes <= 0) return { level: 'expired', expiresInMinutes: 0, rank: urgencyRank.expired };
  const limits = urgencyLimits();
  const level = expiresInMinutes <= limits.critical ? 'critical'
    : expiresInMinutes <= limits.high ? 'high'
      : expiresInMinutes <= limits.medium ? 'medium' : 'low';
  return { level, expiresInMinutes, rank: urgencyRank[level] };
};

const scoreDonationForNgo = (donation, { distanceKm = null, radiusKm = 35, now = Date.now() } = {}) => {
  const urgency = getUrgency(donation.expiry_time, now);
  const available = donation.status === 'available' && urgency.level !== 'expired';
  const weights = {
    distance: Number(process.env.RESCUE_WEIGHT_DISTANCE) || 35,
    urgency: Number(process.env.RESCUE_WEIGHT_URGENCY) || 45,
    safety: Number(process.env.RESCUE_WEIGHT_SAFETY) || 20
  };
  const totalWeight = weights.distance + weights.urgency + weights.safety;
  const distanceScore = Number.isFinite(distanceKm) ? Math.max(0, 100 * (1 - Math.min(distanceKm, radiusKm) / radiusKm)) : 0;
  const urgencyScore = ({ critical: 100, high: 85, medium: 65, low: 40 })[urgency.level] || 0;
  const safetyFlags = [donation.safety_hygiene_confirmed, donation.safety_storage_confirmed, donation.safety_deadline_confirmed, donation.safety_accuracy_confirmed];
  const safetyScore = safetyFlags.every(value => value === true || Number(value) === 1) ? 100 : 0;
  const score = available && totalWeight > 0
    ? Math.round((distanceScore * weights.distance + urgencyScore * weights.urgency + safetyScore * weights.safety) / totalWeight)
    : 0;
  const reasons = [];
  if (Number.isFinite(distanceKm)) reasons.push(`${distanceKm} km away`);
  if (urgency.expiresInMinutes !== null && urgency.level !== 'expired') reasons.push(`Expires in ${urgency.expiresInMinutes} minutes`);
  if (safetyScore) reasons.push('Food safety declarations recorded');
  return {
    score,
    recommended: available && score >= 45,
    urgency: urgency.level,
    expires_in_minutes: urgency.expiresInMinutes,
    recommendation_reasons: reasons
  };
};

module.exports = { getUrgency, scoreDonationForNgo, urgencyRank };
