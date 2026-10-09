import { fetchProfile, notifyError, request } from './api.js';
import { $, $$, escapeHtml, renderList, toast, setLoading } from './utils.js';
import { downloadCertificate } from './certificate.js';
import { openLiveTracker } from './liveTracking.js';
import { openSmartMatchModal } from './smartMatch.js';
import { openLeaderboardModal } from './leaderboard.js';
import { initExpiryCountdowns } from './features.js';

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
  const workflowButton = event.target.closest('[data-ngo-workflow]');
  if (workflowButton) {
    event.preventDefault();
    if (workflowButton.dataset.ngoWorkflow === 'show-distribution') {
      const form = workflowButton.closest('article')?.querySelector('[data-ngo-distribution-form]');
      if (form) form.hidden = !form.hidden;
      if (form) form.style.display = form.hidden ? 'none' : 'grid';
      return;
    }
    const id = workflowButton.dataset.id;
    const actions = {
      start: { url: `/api/ngo/donations/${id}/pickup/start`, method: 'POST', message: 'Pickup started.' },
      collect: { url: `/api/ngo/donations/${id}/pickup/collect`, method: 'POST', message: 'Food collection confirmed.' },
      complete: { url: `/api/ngo/donations/${id}/complete`, method: 'POST', message: 'Rescue completed.' }
    };
    const action = actions[workflowButton.dataset.ngoWorkflow];
    if (!action) return;
    try {
      setLoading(workflowButton, true, 'Updating…');
      await request(action.url, { method: action.method });
      toast(action.message, 'success');
      location.reload();
    } catch (error) { notifyError(error); setLoading(workflowButton, false); }
    return;
  }

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

document.addEventListener('submit', async event => {
  const scheduleForm = event.target.closest('[data-ngo-schedule-form]');
  const distributionForm = event.target.closest('[data-ngo-distribution-form]');
  const form = scheduleForm || distributionForm;
  if (!form) return;
  event.preventDefault();
  const button = form.querySelector('[type="submit"]');
  const id = form.dataset.id;
  try {
    setLoading(button, true, 'Saving…');
    if (scheduleForm) {
      const fields = new FormData(form);
      await request(`/api/ngo/donations/${id}/pickup/schedule`, { method: 'PATCH', body: { pickupDate: fields.get('pickupDate'), pickupTime: fields.get('pickupTime') } });
      toast('Pickup scheduled.', 'success');
    } else {
      await request(`/api/ngo/donations/${id}/distribution`, { method: 'POST', body: new FormData(form), timeoutMs: 60000 });
      toast('Distribution and proof recorded.', 'success');
    }
    location.reload();
  } catch (error) { notifyError(error); setLoading(button, false); }
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
        location.reload();
      } catch (error) { notifyError(error); if (status) status.textContent = 'Could not save location.'; }
      finally { button.disabled = false; }
    }, () => { if (status) status.textContent = 'Location was not shared. Nearby sorting is unavailable until it is set.'; button.disabled = false; }, { timeout: 10000 });
  }, { once: true });
  try {
    const [donationsResult, historyResult, rewardsResult, profileResult] = await Promise.allSettled([
      request('/api/ngo/donations'),
      request('/api/ngo/history'),
      request('/api/rewards/my-points'),
      fetchProfile('/api/ngo/profile')
    ]);
    if (profileResult.status === 'fulfilled') {
      setValues(profileResult.value.profile);
      const welcomeName = $('[data-api-value="fullName"]');
      if (welcomeName) welcomeName.textContent = profileResult.value.profile?.full_name || profileResult.value.profile?.ngo_name || 'NGO Partner';
      const accountStatus = String(profileResult.value.profile?.account_status || 'active').toLowerCase();
      const verification = $('[data-ngo-verification]');
      const heroBadge = $('.ngo-hero-badge');
      if (verification) verification.textContent = accountStatus === 'active' ? 'Active NGO partner' : `Account ${accountStatus.replaceAll('_', ' ')}`;
      if (heroBadge) heroBadge.textContent = accountStatus === 'active' ? '🛡️ Active NGO Partner' : `🛡️ ${accountStatus.replaceAll('_', ' ')}`;
    }
    const ptsEl = document.querySelector('[data-metric="my-points"]');
    const badgeEl = document.querySelector('[data-metric="my-badge"]');
    const donations = donationsResult.status === 'fulfilled' ? donationsResult.value : null;
    const history = historyResult.status === 'fulfilled' ? historyResult.value : null;
    const rewards = rewardsResult.status === 'fulfilled' ? rewardsResult.value : null;
    if (ptsEl) ptsEl.textContent = rewards ? `${rewards.points || 0} pts` : 'Unavailable';
    if (badgeEl) badgeEl.textContent = rewards?.badge || 'Unavailable';

    const availItems = donations?.donations || [];
    const histItems = history?.donations || [];

    const setTxt = (id, val) => { const el = $(`#${id}`); if (el) el.textContent = val; };
    setTxt('count-ngo-available', donations ? availItems.length : 'Unavailable');
    setTxt('count-ngo-active', history ? histItems.filter(d => !['completed', 'cancelled'].includes(d.pickup_status || d.status)).length : 'Unavailable');
    setTxt('count-ngo-pending', history ? histItems.filter(d => ['accepted', 'pickup_scheduled'].includes(d.pickup_status === 'pending' ? d.status : (d.pickup_status || d.status))).length : 'Unavailable');
    setTxt('count-ngo-completed', history ? histItems.filter(d => (d.pickup_status || d.status) === 'completed').length : 'Unavailable');
    const totalImpact = histItems.reduce((sum, d) => sum + (Number(d.number_of_meals) || 0), 0);
    setTxt('count-ngo-impact', history ? (totalImpact > 0 ? `${totalImpact.toLocaleString()} meals` : '0') : 'Unavailable');

    if (donationsResult.status === 'rejected') {
      $('#available-donations-list')?.replaceChildren(Object.assign(document.createElement('p'), { textContent: 'Available donations could not be loaded. Please refresh to try again.' }));
      notifyError(donationsResult.reason);
    }
    if (historyResult.status === 'rejected') {
      $('#ngo-history')?.replaceChildren(Object.assign(document.createElement('p'), { textContent: 'Your rescue history could not be loaded. Please refresh to try again.' }));
      if (donationsResult.status !== 'rejected') notifyError(historyResult.reason);
    }
    if (rewardsResult.status === 'rejected' && donationsResult.status !== 'rejected' && historyResult.status !== 'rejected') {
      notifyError(rewardsResult.reason);
    }
    if (profileResult.status === 'rejected' && donationsResult.status !== 'rejected') {
      const locationStatus = $('#ngo-location-status');
      if (locationStatus) locationStatus.textContent = 'Set your NGO city or location to improve match ranking.';
    }

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
        const urgencyBadge = d.urgency && d.urgency !== 'unknown'
          ? `<span class="badge-urgent-tag">${escapeHtml(d.urgency.toUpperCase())}</span>`
          : '';
        const matchReasons = Array.isArray(d.recommendation_reasons) ? d.recommendation_reasons.join(' · ') : '';
        const detailHref = `/donation-details.html?id=${encodeURIComponent(d.id)}&return=${encodeURIComponent('/ngo/dashboard.html#available-donations')}`;

      card.innerHTML = `
        ${d.food_image ? `<img src="${escapeHtml(d.food_image)}" alt="${escapeHtml(d.food_name)}" loading="lazy" style="width:100%; max-height:220px; object-fit:cover; border-radius:12px; margin-bottom:12px;" />` : ''}
        <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:8px;">
          <div>
            <h3 style="margin:0 0 4px;">${escapeHtml(d.food_name)}</h3>
            <div style="display:flex; gap:6px; align-items:center; flex-wrap:wrap;">
                ${distBadge}
                ${urgentBadge}
                ${urgencyBadge}
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
            ${d.number_of_meals ? `<br><strong>Approx. meals:</strong> ${Number(d.number_of_meals).toLocaleString()}` : ''}
            <br><strong>Donor:</strong> ${escapeHtml(d.business_name || d.owner_name || 'Food donor')}
          </p>
          ${matchReasons ? `<p style="margin:0 0 12px; color:#166534; font-size:.82rem;"><strong>Match:</strong> ${escapeHtml(matchReasons)}</p>` : ''}
        <div style="display:flex; gap:8px;">
          <a class="btn-smart-sm" href="${detailHref}">View Details</a>
          <button type="button" class="btn-accept" data-action="accept-donation" data-id="${d.id}">Accept Donation</button>
          <button type="button" class="btn-smart-sm" data-action="smart-match" data-id="${d.id}">🤖 Smart Match</button>
        </div>
      `;
      return card;
    };

    const availTarget = $('#available-donations-list') || $('#available-donations');
    const locationStatus = $('#ngo-location-status');
    if (locationStatus && donations?.locationRequired) {
      locationStatus.textContent = 'Food listings remain visible; share your location to prioritize nearby matches.';
    }
    const renderFilteredDonations = () => {
      const query = ($('#ngo-food-search')?.value || '').trim().toLocaleLowerCase();
      const category = $('#ngo-food-category')?.value || '';
      const maxKmValue = $('#ngo-food-distance')?.value || 'all';
      const maxKm = maxKmValue === 'all' ? null : Number(maxKmValue);
      const urgentOnly = Boolean($('#ngo-food-urgent')?.checked);
      const sort = $('#ngo-food-sort')?.value || 'recommended';
      const filtered = availItems.filter(d => {
        const terms = [d.food_name, d.category_name, d.pickup_address, d.pickup_city, d.business_city, d.business_name].join(' ').toLocaleLowerCase();
        return (!query || terms.includes(query)) && (!category || String(d.category_name || '') === category)
          && (maxKm === null || (d.distance_km !== null && d.distance_km !== undefined && Number(d.distance_km) <= maxKm))
          && (!urgentOnly || d.is_urgent);
      });
      filtered.sort((a, b) => {
        if (sort === 'nearest') return (a.distance_km ?? Infinity) - (b.distance_km ?? Infinity);
        if (sort === 'urgent') return new Date(a.expiry_time) - new Date(b.expiry_time);
        if (Boolean(a.is_emergency) !== Boolean(b.is_emergency)) return a.is_emergency ? -1 : 1;
        if (Boolean(a.is_urgent) !== Boolean(b.is_urgent)) return a.is_urgent ? -1 : 1;
        return (a.distance_km ?? Infinity) - (b.distance_km ?? Infinity);
      });
      const summary = $('#ngo-feed-summary');
      if (summary) summary.textContent = `${filtered.length} of ${availItems.length} available donations`;
      renderList(availTarget, filtered, renderAvailableDonation, 'No available food matches these filters. Try widening the distance or clearing a filter.');
      initExpiryCountdowns();
    };
    const categorySelect = $('#ngo-food-category');
    if (categorySelect) [...new Set(availItems.map(d => d.category_name).filter(Boolean))].sort().forEach(category => categorySelect.add(new Option(category, category)));
    ['#ngo-food-search', '#ngo-food-category', '#ngo-food-distance', '#ngo-food-sort', '#ngo-food-urgent'].forEach(selector => {
      const input = $(selector);
      input?.addEventListener(input.type === 'search' ? 'input' : 'change', renderFilteredDonations);
    });
    if (donations) renderFilteredDonations();
    const recommended = availItems.filter(d => d.recommended);
    renderList($('#recommended-donations-list'), recommended, renderAvailableDonation, 'No donations currently match your location and food-safety criteria.');

    // History Card Renderer
    if (history) renderList($('#ngo-history'), history.donations, d => {
      const card = document.createElement('article');
      const status = d.pickup_status === 'pending' ? d.status : (d.pickup_status || d.status);
      card.className = 'donation-card ngo-rescue-card';
      card.dataset.rescueStatus = status;
      let actionMarkup = formatStatus(status);
      if (status === 'accepted') actionMarkup = `<form data-ngo-schedule-form data-id="${d.id}" style="display:flex;gap:8px;flex-wrap:wrap;align-items:end;"><label>Pickup date<input type="date" name="pickupDate" required></label><label>Pickup time<input type="time" name="pickupTime" required></label><button type="submit" class="btn-confirm">Schedule Pickup</button></form>`;
      else if (status === 'pickup_scheduled') actionMarkup = `<button type="button" class="btn-confirm" data-ngo-workflow="start" data-id="${d.id}">Start Pickup</button>`;
      else if (status === 'pickup_started') actionMarkup = `<button type="button" class="btn-confirm" data-ngo-workflow="collect" data-id="${d.id}">Confirm Food Collected</button>`;
      else if (status === 'food_collected') actionMarkup = `<button type="button" class="btn-confirm" data-ngo-workflow="show-distribution" data-id="${d.id}">Record Distribution</button>
        <form data-ngo-distribution-form data-id="${d.id}" hidden style="display:none;gap:8px;margin-top:12px;">
          <label>People served<input name="peopleServed" type="number" min="1" max="1000000" required></label>
          <label>Distribution location<input name="distributionLocation" maxlength="255" required></label>
          <label>Distribution date and time<input name="distributionDateTime" type="datetime-local" required></label>
          <label>Notes<textarea name="distributionNotes" maxlength="1000" rows="2"></textarea></label>
          <label>Proof photo<input name="image" type="file" accept="image/png,image/jpeg,image/webp" required></label>
          <button type="submit" class="btn-confirm">Save Distribution</button>
        </form>`;
      else if (status === 'delivered') actionMarkup = `<button type="button" class="btn-confirm" data-ngo-workflow="complete" data-id="${d.id}">Complete Rescue</button>`;
      const chatAction = `<button type="button" class="btn-smart-sm" data-action="open-chat" data-id="${d.id}">💬 Chat with donor</button>`;
      const detailHref = `/donation-details.html?id=${encodeURIComponent(d.id)}&return=${encodeURIComponent('/ngo/dashboard.html#active-rescues')}`;

      card.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <div>
            <h3 style="margin:0;">${escapeHtml(d.food_name)}</h3>
            <small style="color:#666;">${escapeHtml(d.quantity)} &bull; ${escapeHtml(d.pickup_address || '')}</small>
          </div>
          <div style="display:flex; gap:8px; align-items:center;">
            ${formatStatus(status)}
            <a class="btn-smart-sm" href="${detailHref}">View Details</a>
            ${chatAction}
          </div>
        </div>
        <div style="margin-top:12px;">${actionMarkup}</div>
      `;
      return card;
    }, 'Your accepted donations and completed rescues will appear here.');

    const rescueCards = $$('.ngo-rescue-card', $('#ngo-history'));
    const historySummary = $('#ngo-history-summary');
    const applyHistoryFilter = selected => {
      let visible = 0;
      rescueCards.forEach(card => {
        const status = card.dataset.rescueStatus;
        const matches = selected === 'all' || (selected === 'active' && !['completed', 'cancelled'].includes(status)) || (selected === 'completed' && status === 'completed');
        card.hidden = !matches;
        if (matches) visible += 1;
      });
      if (historySummary) historySummary.textContent = `${visible} ${selected === 'all' ? 'rescue records' : `${selected} rescues`}`;
    };
    $$('[data-history-filter]').forEach(button => button.addEventListener('click', () => {
      $$('[data-history-filter]').forEach(tab => {
        const active = tab === button;
        tab.classList.toggle('is-active', active);
        tab.setAttribute('aria-pressed', String(active));
      });
      applyHistoryFilter(button.dataset.historyFilter);
    }));
    if (history) applyHistoryFilter('all');

    initExpiryCountdowns();
  } catch (error) {
    ['count-ngo-available', 'count-ngo-active', 'count-ngo-pending', 'count-ngo-completed', 'count-ngo-impact'].forEach(id => {
      const metric = $(`#${id}`);
      if (metric) metric.textContent = 'Unavailable';
    });
    const available = $('#available-donations-list');
    if (available) available.textContent = 'Your NGO profile could not be loaded, so available donations are unavailable.';
    const history = $('#ngo-history');
    if (history) history.textContent = 'Your NGO profile could not be loaded, so rescue history is unavailable.';
    notifyError(error);
  }
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
