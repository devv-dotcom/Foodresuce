import { $, formDataObject } from './utils.js';

export const predictFreshness = ({ preparationTime, expiryTime, foodType = 'veg', storage = 'ambient' }) => {
  const now = Date.now(); const prepared = new Date(preparationTime).getTime(); const expiry = new Date(expiryTime).getTime();
  if (!Number.isFinite(prepared) || !Number.isFinite(expiry) || expiry <= prepared) return null;
  const remaining = expiry - now;
  const remainingHours = Math.max(0, remaining / 3600000);
  const status = remaining <= 0 ? 'Past deadline — do not list' : remainingHours < 1 ? 'Immediate pickup needed' : remainingHours < 3 ? 'Pickup soon' : 'Pickup window available';
  const storageLabel = { chilled: 'chilled', insulated: 'insulated', ambient: 'ambient' }[storage] || 'donor-reported';
  const typeLabel = foodType === 'non_veg' ? 'non-vegetarian' : 'vegetarian';
  return { remainingHours: Number(remainingHours.toFixed(1)), status, expiry: new Date(expiry).toLocaleString(), handling: `${typeLabel}; ${storageLabel} storage declared`, warning: 'Timing and storage are donor-reported planning details. This estimate cannot determine whether food is safe. Recipients must assess food and handling conditions at collection.' };
};

export const initFreshnessPredictor = () => {
  const form = $('[data-freshness-predictor]'); const output = $('[data-freshness-result]'); if (!form || !output) return;
  const render = () => { const result = predictFreshness(formDataObject(form)); if (!result) { output.hidden = true; return; } output.hidden = false; output.innerHTML = `<strong>${result.status}</strong><span>About ${result.remainingHours} hours until the entered deadline · ${result.handling}</span><small>Entered deadline: ${result.expiry}. ${result.warning}</small>`; output.dataset.status = result.remainingHours < 1 ? 'urgent' : result.remainingHours < 3 ? 'soon' : 'good'; };
  form.addEventListener('input', render); form.addEventListener('change', render); render();
};
