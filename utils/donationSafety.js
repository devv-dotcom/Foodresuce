'use strict';

const safetyDeclarationComplete = body => ['safetyHygiene', 'safetyFreshness', 'safetyPackaging', 'safetyAccuracy']
  .every(field => body[field] === true || ['true', '1', 'on'].includes(String(body[field] || '').toLowerCase()));

const donationWindowError = (body, now = Date.now()) => {
  const preparation = new Date(body.preparationTime).getTime();
  const expiry = new Date(body.expiryTime).getTime();
  const pickup = new Date(body.pickupDateTime).getTime();
  if (![preparation, expiry, pickup].every(Number.isFinite)) return 'Enter valid preparation, pickup, and deadline times.';
  if (preparation > now) return 'Preparation time cannot be in the future.';
  if (expiry <= preparation) return 'The collection deadline must be after preparation time.';
  if (expiry <= now) return 'This food has passed its listed collection deadline and cannot be posted.';
  if (pickup < preparation || pickup > expiry) return 'Pickup time must fall between preparation time and the collection deadline.';
  return null;
};

module.exports = { safetyDeclarationComplete, donationWindowError };
