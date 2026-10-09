import { fetchProfile, notifyError, request } from './api.js';
import { $, $$, escapeHtml, renderList, toast, setLoading } from './utils.js';
import { downloadCertificate } from './certificate.js';
import { openLiveTracker } from './liveTracking.js';
import { openSmartMatchModal } from './smartMatch.js';
import { openLeaderboardModal } from './leaderboard.js';
import { initExpiryCountdowns } from './features.js';

let userCoords = null;
const acquireCoords = () => new Promise(resolve => {
  if (userCoords) return resolve(userCoords);
  if (!navigator.geolocation) return resolve(null);
  navigator.geolocation.getCurrentPosition(
    pos => {
      userCoords = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
      resolve(userCoords);
    },
    () => resolve(null),
    { timeout: 8000 }
  );
});

const setValues = (data, root = document) => $$('[data-api-value]', root).forEach(element => {
  const value = element.dataset.apiValue.split('.').reduce((current, key) => current?.[key], data);
  element.textContent = value ?? '—';
});

const formatStatus = status => {
  const formatted = (status || 'available').replace('_', ' ');
  return `<span class="status-pill status-${status}">${escapeHtml(formatted)}</span>`;
};

/**
 * Universal Action Handler: Delegated clicks for Smart Match, Tracking, Certificates, Leaderboards
 */
document.addEventListener('click', async event => {
  // Download Certificate
  const certBtn = event.target.closest('[data-action="download-cert"]');
  if (certBtn) {
    event.preventDefault();
    await downloadCertificate(certBtn.dataset.id);
    return;
  }

  // Open Live Tracker
  const trackBtn = event.target.closest('[data-action="track-pickup"]');
  if (trackBtn) {
    event.preventDefault();
    await openLiveTracker(trackBtn.dataset.id);
    return;
  }

  // Open Smart Match
  const matchBtn = event.target.closest('[data-action="smart-match"]');
  if (matchBtn) {
    event.preventDefault();
    await openSmartMatchModal(matchBtn.dataset.id);
    return;
  }

  // Open Leaderboard
  const leaderBtn = event.target.closest('[data-action="open-leaderboard"]');
  if (leaderBtn) {
    event.preventDefault();
    await openLeaderboardModal();
    return;
  }

  // Accept Pickup Mission
  const acceptPickupBtn = event.target.closest('[data-action="accept-pickup"]');
  if (acceptPickupBtn) {
    event.preventDefault();
    const id = acceptPickupBtn.dataset.id;
    try {
      setLoading(acceptPickupBtn, true, 'Accepting…');
      await request(`/api/pickups/accept/${id}`, { method: 'POST' });
      toast('🎉 Mission Accepted! Pickup route added to active assignments.');
      setTimeout(() => location.reload(), 700);
    } catch (err) {
      notifyError(err);
      setLoading(acceptPickupBtn, false);
    }
    return;
  }

  // Advance Pickup Stage
  const advanceBtn = event.target.closest('[data-action="advance-stage"]');
  if (advanceBtn) {
    event.preventDefault();
    const { id, nextStage } = advanceBtn.dataset;
    try {
      setLoading(advanceBtn, true, 'Updating…');
      await request(`/api/pickups/${nextStage}/${id}`, { method: 'PUT' });
      toast(`Stage updated successfully!`);
      setTimeout(() => location.reload(), 600);
    } catch (err) {
      notifyError(err);
      setLoading(advanceBtn, false);
    }
    return;
  }

  // Accept Donation (NGO)
  const acceptDonationBtn = event.target.closest('[data-action="accept-donation"]');
  if (acceptDonationBtn) {
    event.preventDefault();
    const id = acceptDonationBtn.dataset.id;
    try {
      setLoading(acceptDonationBtn, true, 'Claiming…');
      await request(`/api/ngo/accept/${id}`, { method: 'POST' });
      toast('🎉 Donation claimed! NGO pickup scheduled.');
      setTimeout(() => location.reload(), 700);
    } catch (err) {
      notifyError(err);
      setLoading(acceptDonationBtn, false);
    }
    return;
  }

  // Confirm Delivery / Distribution (NGO)
  const confirmDeliveryBtn = event.target.closest('[data-action="confirm-delivery"]');
  if (confirmDeliveryBtn) {
    event.preventDefault();
    const id = confirmDeliveryBtn.dataset.id;
    try {
      setLoading(confirmDeliveryBtn, true, 'Confirming…');
      await request(`/api/ngo/confirm-delivery/${id}`, { method: 'POST', body: { numberOfPeopleFed: 25 } });
      toast('✅ Delivery confirmed! Impact points recorded.');
      setTimeout(() => location.reload(), 700);
    } catch (err) {
      notifyError(err);
      setLoading(confirmDeliveryBtn, false);
    }
    return;
  }
});

/**
 * Business Dashboard
 */
export const initBusinessDashboard = async () => {
  if (!document.body.matches('[data-dashboard="business"]')) return;
  try {
    const [dashboardResult, donationsResult, rewardsResult] = await Promise.allSettled([
      request('/api/business/dashboard'),
      request('/api/business/donations'),
      request('/api/rewards/my-points').catch(error => { notifyError(error); return null; })
    ]);

    if (dashboardResult.status === 'fulfilled') setValues(dashboardResult.value.dashboard);
    else notifyError(dashboardResult.reason);

    // Set Impact Points & Badge
    const ptsEl = document.querySelector('[data-metric="my-points"]');
    const badgeEl = document.querySelector('[data-metric="my-badge"]');
    if (donationsResult.status === 'rejected') {
      const history = $('#donation-history');
      if (history) history.textContent = 'Your donation history could not be loaded. Please refresh and try again.';
      notifyError(donationsResult.reason);
      return;
    }
    const donations = donationsResult.value;
    const rewards = rewardsResult.status === 'fulfilled' ? rewardsResult.value : null;
    if (ptsEl) ptsEl.textContent = rewards ? `${rewards.points || 0} pts` : '—';
    if (badgeEl) badgeEl.textContent = rewards?.badge || '—';

    renderList($('#donation-history'), donations.donations, d => {
      const item = document.createElement('article');
      item.className = 'api-list-item';
      const isCompleted = d.status === 'completed' || d.status === 'delivered';
      const certAction = isCompleted
        ? `<button type="button" class="btn-cert" data-action="download-cert" data-id="${d.id}">📜 Get Certificate</button>`
        : '';
      const smartAction = d.status === 'available'
        ? `<button type="button" class="btn-smart-sm" data-action="smart-match" data-id="${d.id}">🤖 AI Dispatch</button>`
        : '';
      const chatAction = d.status !== 'available' && d.status !== 'cancelled'
        ? `<button type="button" class="btn-smart-sm" data-action="open-chat" data-id="${d.id}">💬 Chat with NGO</button>`
        : '';

      item.innerHTML = `
        <div style="display:flex; flex-direction:column; gap:4px;">
          <strong>${escapeHtml(d.food_name || 'Food Listing')}</strong>
          <span style="font-size:.82rem; color:#657166;">
            ${escapeHtml(d.quantity || '')} &bull; ${escapeHtml(d.pickup_address || d.city || '')}
          </span>
          <span data-expiry-time="${d.expiry_time}">${d.countdown_text || ''}</span>
        </div>
        <div style="display:flex; align-items:center; gap:8px;">
          ${smartAction}
          ${chatAction}
          ${formatStatus(d.status)}
          ${certAction}
        </div>
      `;
      return item;
    }, 'No donations listed yet.');

    initExpiryCountdowns();
  } catch (error) { notifyError(error); }
};

/**
 * NGO Dashboard
 */
export const initNgoDashboard = async () => {
  if (!document.body.matches('[data-dashboard="ngo"]')) return;
  $('#ngo-update-location')?.addEventListener('click', event => {
    const button = event.currentTarget;
    const status = $('#ngo-location-status');
    if (!navigator.geolocation) { if (status) status.textContent = 'Location is not supported by this browser.'; return; }
    button.disabled = true;
    if (status) status.textContent = 'Requesting your location…';
    navigator.geolocation.getCurrentPosition(async position => {
      try {
        await request('/api/ngo/location', { method: 'PATCH', body: { latitude: position.coords.latitude, longitude: position.coords.longitude } });
        if (status) status.textContent = 'Location saved for nearby donation matching.';
        toast('NGO location updated.');
      } catch (error) { notifyError(error); if (status) status.textContent = 'Could not save location.'; }
      finally { button.disabled = false; }
    }, () => { if (status) status.textContent = 'Location was not shared. Nearby sorting is unavailable until it is set.'; button.disabled = false; }, { timeout: 10000 });
  }, { once: true });
  try {
    const profile = await fetchProfile('/api/ngo/profile');
    const hasSavedCoords = profile.profile?.latitude !== null && profile.profile?.latitude !== undefined && profile.profile?.longitude !== null && profile.profile?.longitude !== undefined;
    const coords = await acquireCoords() || (hasSavedCoords && Number.isFinite(Number(profile.profile.latitude)) && Number.isFinite(Number(profile.profile.longitude))
      ? { latitude: Number(profile.profile.latitude), longitude: Number(profile.profile.longitude) }
      : null);
    const queryParams = coords ? `?latitude=${coords.latitude}&longitude=${coords.longitude}` : '';

    const [donations, history, rewards] = await Promise.all([
      request(`/api/ngo/donations${queryParams}`),
      request('/api/ngo/history'),
      request('/api/rewards/my-points').catch(error => { notifyError(error); return null; })
    ]);

    setValues(profile.profile);

    const ptsEl = document.querySelector('[data-metric="my-points"]');
    if (ptsEl) ptsEl.textContent = rewards ? `${rewards.points || 0} pts` : '—';

    const availItems = donations.donations || [];
    const histItems = history.donations || [];

    const setTxt = (id, val) => { const el = $(`#${id}`); if (el) el.textContent = val; };
    setTxt('count-ngo-available', availItems.length);
    setTxt('count-ngo-active', histItems.filter(d => ['accepted','volunteer_assigned','in_transit'].includes(d.status)).length);
    setTxt('count-ngo-completed', histItems.filter(d => ['delivered','completed'].includes(d.status)).length);
    const totalImpact = histItems.reduce((sum, d) => sum + (Number(d.number_of_meals) || 0), 0);
    setTxt('count-ngo-impact', totalImpact > 0 ? `${totalImpact.toLocaleString()} meals` : '0');

    // Available Donations Card Renderer
    const renderAvailableDonation = d => {
      const card = document.createElement('article');
      card.className = `donation-card ${d.is_urgent ? 'urgent-border' : ''}`;
      const donorDeclarationsComplete = [d.safety_hygiene_confirmed, d.safety_storage_confirmed, d.safety_deadline_confirmed, d.safety_accuracy_confirmed]
        .every(value => value === true || Number(value) === 1);
      const distBadge = d.distance_km !== null
        ? `<span class="badge-distance">📍 ${d.distance_km} km away</span>`
        : '';
      const urgentBadge = d.is_urgent
        ? `<span class="badge-urgent-tag">🚨 Urgent (<2h)</span>`
        : '';

      card.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:8px;">
          <div>
            <h3 style="margin:0 0 4px;">${escapeHtml(d.food_name)}</h3>
            <div style="display:flex; gap:6px; align-items:center; flex-wrap:wrap;">
              ${distBadge}
              ${urgentBadge}
              <span class="badge-declarations">${donorDeclarationsComplete ? 'Donor declarations recorded' : 'Legacy listing · details unavailable'}</span>
            </div>
          </div>
          <span data-expiry-time="${d.expiry_time}">${d.countdown_text || ''}</span>
        </div>
        <p style="margin:6px 0 12px; font-size:.86rem; color:#475549;">
          <strong>Quantity:</strong> ${escapeHtml(d.quantity)} &bull; 
          <strong>Type:</strong> ${escapeHtml(d.food_type === 'veg' ? '🥦 Veg' : '🍗 Non-Veg')} &bull; 
          <strong>Pickup:</strong> ${escapeHtml([d.pickup_address, d.pickup_city || d.business_city || d.city].filter(Boolean).join(', '))}<br>
          <strong>Storage declared:</strong> ${escapeHtml(d.storage_condition || 'Not recorded')}
        </p>
        <div style="display:flex; gap:8px;">
          <button type="button" class="btn-accept" data-action="accept-donation" data-id="${d.id}">Accept Donation</button>
          <button type="button" class="btn-smart-sm" data-action="smart-match" data-id="${d.id}">🤖 Smart Match</button>
        </div>
      `;
      return card;
    };

    const availTarget = $('#available-donations-list') || $('#available-donations');
    renderList(availTarget, availItems, renderAvailableDonation, 'No food donations are currently available in your radius.');

    // History Card Renderer
    renderList($('#ngo-history'), history.donations, d => {
      const card = document.createElement('article');
      card.className = 'donation-card';
      const showConfirm = d.status === 'delivered' || d.status === 'picked_up' || d.status === 'accepted';
      const actionBtn = showConfirm && d.status !== 'completed'
        ? `<button type="button" class="btn-confirm" data-action="confirm-delivery" data-id="${d.id}">Confirm Delivery</button>`
        : formatStatus(d.status);
      const chatAction = `<button type="button" class="btn-smart-sm" data-action="open-chat" data-id="${d.id}">💬 Chat with donor</button>`;

      card.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <div>
            <h3 style="margin:0;">${escapeHtml(d.food_name)}</h3>
            <small style="color:#666;">${escapeHtml(d.quantity)} &bull; ${escapeHtml(d.pickup_address || '')}</small>
          </div>
          <div style="display:flex; gap:8px; align-items:center;">
            ${formatStatus(d.status)}
            ${chatAction}
            ${actionBtn}
          </div>
        </div>
      `;
      return card;
    }, 'No donation history yet.');

    initExpiryCountdowns();
  } catch (error) { notifyError(error); }
};


/**
 * Admin Dashboard & Live Operations Command Center
 */
export const initAdminDashboard = async () => {
  if (!document.body.matches('[data-dashboard="admin"]')) return;
  try {
    const [dashboard, analytics, businesses, ngos] = await Promise.all([
      request('/api/admin/dashboard'),
      request('/api/admin/analytics'),
      request('/api/admin/businesses?limit=5'),
      request('/api/admin/ngos?limit=5')
    ]);

    setValues(dashboard.dashboard);

    // Live Operations status cards
    const liveStats = analytics.analytics?.liveStatus || {};
    const setStat = (sel, val) => {
      const el = document.querySelector(sel);
      if (el) el.textContent = val ?? 0;
    };

    setStat('[data-metric="urgent-donations"]', liveStats.urgent_donations || 0);
    setStat('[data-metric="available-donations"]', liveStats.available_donations || 0);
    setStat('[data-metric="active-operations"]', liveStats.active_operations || 0);
    setStat('[data-metric="completed-donations"]', liveStats.completed_donations || 0);

    // Dynamic environmental stats
    const a = analytics.analytics || {};
    setStat('[data-metric="kg-food-saved"]', `${a.kgFoodSaved || 0} kg`);
    setStat('[data-metric="co2-avoided"]', `${a.co2AvoidedKg || 0} kg`);
    setStat('[data-metric="beneficiaries"]', a.beneficiariesReached || 0);

    // Moderation queue table: Pending Verification
    const modContainer = document.getElementById('pending-moderation-list');
    if (modContainer) {
      const allPending = [
        ...(businesses.businesses || []).map(b => ({ id: b.id, name: b.business_name || b.full_name, role: 'business', status: b.account_status })),
        ...(ngos.ngos || []).map(n => ({ id: n.id, name: n.ngo_name || n.full_name, role: 'ngo', status: n.account_status }))
      ].filter(x => x.status === 'pending');

      renderList(modContainer, allPending, item => {
        const row = document.createElement('div');
        row.className = 'moderation-row';
        row.innerHTML = `
          <div>
            <strong>${escapeHtml(item.name)}</strong>
            <span class="badge-role">${item.role.toUpperCase()}</span>
          </div>
          <div style="display:flex; gap:6px;">
            <button type="button" class="btn-approve" data-mod-role="${item.role}" data-mod-id="${item.id}">Approve</button>
            <button type="button" class="btn-reject" data-mod-role="${item.role}" data-mod-id="${item.id}">Reject</button>
          </div>
        `;
        return row;
      }, 'No pending partner verifications.');

      modContainer.addEventListener('click', async e => {
        const approveBtn = e.target.closest('.btn-approve');
        const rejectBtn = e.target.closest('.btn-reject');
        if (approveBtn) {
          const { modRole, modId } = approveBtn.dataset;
          await request(`/api/admin/${modRole}/approve/${modId}`, { method: 'PUT' });
          toast(`${modRole} approved successfully!`);
          approveBtn.closest('.moderation-row')?.remove();
        } else if (rejectBtn) {
          const { modRole, modId } = rejectBtn.dataset;
          await request(`/api/admin/${modRole}/reject/${modId}`, { method: 'PUT' });
          toast(`${modRole} rejected.`);
          rejectBtn.closest('.moderation-row')?.remove();
        }
      });
    }

  } catch (error) { notifyError(error); }
};
