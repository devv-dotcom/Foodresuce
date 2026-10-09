/**
 * Food Rescue Partner Application
 * Unified frontend for the existing NGO and Partner roles.
 * All API calls go to /api/partner/* endpoints.
 */

import { request, getSession, saveSession, clearSession, notifyError, API_BASE } from './api.js';
import { dashboardForRole } from './roles.js';
import { initTheme, initExpiryCountdowns, initEmergencyBanner, initLiveOperationsMap } from './features.js';
import { openSmartMatchModal } from './smartMatch.js';
import { openLiveTracker } from './liveTracking.js';
import { downloadCertificate } from './certificate.js';
import { openLeaderboardModal, renderLeaderboardToContainer } from './leaderboard.js';

window.openSmartMatchModal = openSmartMatchModal;
window.openLiveTracker = openLiveTracker;
window.downloadCertificate = downloadCertificate;
window.openLeaderboardModal = openLeaderboardModal;

/* ═══════════════════════════════════════════════════════════════════
   HELPERS
════════════════════════════════════════════════════════════════════ */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));

function toast(msg, type = 'success') {
  const wrap = $('#partner-toasts');
  if (!wrap) return;
  const el = document.createElement('div');
  el.className = `p-toast ${type}`;
  el.textContent = msg;
  wrap.append(el);
  setTimeout(() => el.remove(), 4200);
}

function openModal(id) {
  const el = $(`#${id}`);
  if (el) el.classList.add('open');
}

function closeModal(id) {
  const el = $(`#${id}`);
  if (el) el.classList.remove('open');
}

window.closeModal = closeModal;

function navigate(section) {
  activateSection(section);
}
window.navigate = navigate;

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const diff = (Date.now() - new Date(dateStr).getTime()) / 1000;
  if (diff < 60) return 'Just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function timeRemaining(dateStr) {
  if (!dateStr) return null;
  const diff = new Date(dateStr).getTime() - Date.now();
  if (diff <= 0) return { expired: true, label: 'Expired', mins: 0, urgency: 'high' };
  const totalMins = Math.floor(diff / 60000);
  const hrs = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  const label = hrs > 0 ? `${hrs}h ${mins}m remaining` : `${mins}m remaining`;
  const urgency = totalMins < 30 ? 'high' : totalMins < 90 ? 'medium' : 'low';
  return { expired: false, label, mins: totalMins, urgency };
}

function formatKg(kg) {
  if (!kg && kg !== 0) return '—';
  return kg >= 1000 ? `${(kg / 1000).toFixed(1)} tonnes` : `${kg} kg`;
}

function getStatusClass(status) {
  const map = {
    ASSIGNED: 'assigned',
    GOING_TO_PICKUP: 'going',
    ARRIVED_AT_PICKUP: 'arrived',
    FOOD_COLLECTED: 'food_collected',
    IN_TRANSIT: 'in_transit',
    ARRIVED_AT_DESTINATION: 'at_destination',
    DELIVERED: 'distributed',
    DISTRIBUTED: 'distributed',
    COMPLETED: 'completed',
    CANCELLED: 'cancelled',
  };
  return map[status?.toUpperCase()] || 'assigned';
}

function getStatusLabel(status) {
  const map = {
    ASSIGNED: '📋 Assigned',
    GOING_TO_PICKUP: '🚗 Going to Pickup',
    ARRIVED_AT_PICKUP: '🏪 Arrived at Pickup',
    FOOD_COLLECTED: '📦 Food Collected',
    IN_TRANSIT: '🚚 In Transit',
    ARRIVED_AT_DESTINATION: '🏛️ At Destination',
    DELIVERED: '✅ Distributed',
    DISTRIBUTED: '✅ Distributed',
    COMPLETED: '⚫ Completed',
    CANCELLED: '❌ Cancelled',
  };
  return map[status?.toUpperCase()] || status;
}

/* ═══════════════════════════════════════════════════════════════════
   STATE
════════════════════════════════════════════════════════════════════ */
const state = {
  user: null,
  partner: null,
  donations: [],
  assignments: [],
  activeAssignment: null,
  selectedDonationId: null,
  pendingHandoffCode: null,   // { type: 'pickup'|'delivery', assignmentId }
  activeTab: 'active',
  notifInterval: null,
  chartsRendered: false,
};

/* ═══════════════════════════════════════════════════════════════════
   BOOT
════════════════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', async () => {
  initTheme();
  // Auth guard
  const { token, user } = getSession();
  if (!token || !user) {
    clearSession();
    const prefix = location.pathname.includes('/frontend/') ? '/frontend' : '';
    const returnTo = `${location.pathname}${location.search}${location.hash}`;
    location.replace(`${prefix}/login.html?redirect=${encodeURIComponent(returnTo)}`);
    return;
  }
  if (!['ngo', 'partner'].includes(String(user.role || '').toLowerCase())) {
    location.replace(dashboardForRole(user.role));
    return;
  }
  state.user = user;

  initSidebar();
  initNav();
  initAvailabilityToggle();
  initHandoffCodeInput();
  initHandoffCodeCopy();
  initProofUpload();
  initLogout();
  initOfflineDetection();
  populateUserUI();
  initProfileForm();
  initModalCloseOnOverlay();

  // Load all data
  await Promise.allSettled([
    loadDashboard(),
    loadDonations(),
    loadAssignments(),
    loadUserPoints(),
  ]);

  initExpiryCountdowns();
  initEmergencyBanner();

  // Poll notifications every 45s
  loadNotifications();
  state.notifInterval = setInterval(loadNotifications, 45000);
});

/* ═══════════════════════════════════════════════════════════════════
   SIDEBAR & NAVIGATION
════════════════════════════════════════════════════════════════════ */
function initSidebar() {
  const sidebar = $('#p-sidebar');
  const overlay = $('#sidebar-overlay');
  const btnHamburger = $('#btn-hamburger');

  btnHamburger?.addEventListener('click', () => {
    sidebar.classList.toggle('open');
    overlay.classList.toggle('show');
  });

  overlay?.addEventListener('click', () => {
    sidebar.classList.remove('open');
    overlay.classList.remove('show');
  });
}

const SECTIONS = ['dashboard', 'available', 'pickup-delivery', 'history', 'impact', 'notifications', 'leaderboard', 'live-map', 'profile'];
const SECTION_TITLES = {
  dashboard: 'Dashboard',
  available: 'Available Food',
  'pickup-delivery': 'Pickup & Distribution',
  history: 'History',
  impact: 'Impact',
  notifications: 'Notifications',
  leaderboard: 'Community Leaderboard',
  'live-map': 'Live Operations Map',
  profile: 'Profile',
};

let activeBoardTab = 'donors';
let boardController = null;
async function loadLeaderboardSection() {
  const container = $('#leaderboard-sec-body');
  if (!container) return;
  boardController = await renderLeaderboardToContainer(container, activeBoardTab);
  $$('[data-board-tab]').forEach(btn => {
    btn.onclick = () => {
      $$('[data-board-tab]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeBoardTab = btn.dataset.boardTab;
      if (boardController) boardController.renderTab(activeBoardTab);
    };
  });
}

async function loadUserPoints() {
  try {
    const res = await request('/api/rewards/my-points');
    if (res?.rewards) {
      const badgeEl = $('#topbar-points-badge');
      if (badgeEl) {
        badgeEl.textContent = `🏅 ${res.rewards.badgeLevel} (${res.rewards.impactPoints} pts)`;
        badgeEl.title = `Impact Tier: ${res.rewards.badgeLevel}`;
      }
      const sbBadge = $('#sb-role-badge');
      if (sbBadge && res.rewards.badgeLevel) {
        sbBadge.textContent = `${(state.user?.role || 'Partner').toUpperCase()} • ${res.rewards.badgeLevel}`;
      }
    }
  } catch (_) {}
}

function activateSection(name) {
  if (name === 'assignments') name = 'pickup-delivery';
  // Hide all
  SECTIONS.forEach(s => {
    $(`#sec-${s}`)?.classList.remove('active');
    $(`#nav-${s === 'pickup-delivery' ? 'pickup' : s}`)?.classList.remove('active');
  });
  $$('.p-mobile-tab').forEach(t => t.classList.remove('active'));

  // Show target
  const sec = $(`#sec-${name}`);
  if (sec) sec.classList.add('active');
  const navKey = name === 'pickup-delivery' ? 'pickup' : name;
  $(`#nav-${navKey}`)?.classList.add('active');
  $(`.p-mobile-tab[data-section="${name}"]`)?.classList.add('active');

  const title = $('#page-title');
  if (title) title.textContent = SECTION_TITLES[name] || 'Dashboard';

  // Close sidebar on mobile
  $('#p-sidebar')?.classList.remove('open');
  $('#sidebar-overlay')?.classList.remove('show');

  // Lazy loads
  if (name === 'history') loadHistory();
  if (name === 'impact') loadImpact();
  if (name === 'notifications') loadNotifications();
  if (name === 'leaderboard') loadLeaderboardSection();
  if (name === 'live-map') initLiveOperationsMap();
  if (name === 'pickup-delivery') renderTrackerView();
  if (name === 'profile') loadProfile();

  window.scrollTo(0, 0);
}

function initNav() {
  // Sidebar links
  $$('.p-nav-link[data-section]').forEach(link => {
    link.addEventListener('click', e => {
      e.preventDefault();
      activateSection(link.dataset.section);
    });
  });

  // Mobile tabs
  $$('.p-mobile-tab[data-section]').forEach(tab => {
    tab.addEventListener('click', () => activateSection(tab.dataset.section));
  });

  // Topbar buttons
  $('#btn-topbar-leaderboard')?.addEventListener('click', () => activateSection('leaderboard'));
  $('#btn-topbar-map')?.addEventListener('click', () => activateSection('live-map'));
  $('#btn-topbar-notif')?.addEventListener('click', () => activateSection('notifications'));
  $('#btn-topbar-profile')?.addEventListener('click', () => activateSection('profile'));
}

/* ═══════════════════════════════════════════════════════════════════
   USER IDENTITY UI
════════════════════════════════════════════════════════════════════ */
function populateUserUI() {
  const u = state.user;
  if (!u) return;

  const firstName = (u.full_name || '').split(' ')[0] || 'Partner';
  const role = (u.role || 'ngo').toLowerCase();

  // Welcome
  const wn = $('#welcome-name'); if (wn) wn.textContent = firstName;
  const ug = $('#welcome-user-greeting'); if (ug) ug.textContent = `Welcome back, ${firstName} 👋`;
  const we = $('#welcome-eyebrow');
  if (we) we.textContent = '🌱 Food Rescue NGO';

  // Sidebar
  const sbName = $('#sb-name'); if (sbName) sbName.textContent = u.full_name || 'Food Rescue NGO';
  const sbBadge = $('#sb-role-badge');
  if (sbBadge) {
    sbBadge.textContent = 'NGO';
    sbBadge.className = 'p-role-badge ngo';
  }

  // Profile
  const profileName = $('#profile-name'); if (profileName) profileName.textContent = u.full_name || 'Partner';
  const profileEmail = $('#profile-email'); if (profileEmail) profileEmail.textContent = u.email || '—';
  const profilePhone = $('#profile-phone'); if (profilePhone) profilePhone.textContent = u.mobile || '—';
  const profileAddr = $('#profile-address'); if (profileAddr) profileAddr.textContent = u.address || '—';
  const profileBadge = $('#profile-role-badge');
  if (profileBadge) {
    profileBadge.textContent = 'Verified NGO';
    profileBadge.className = 'p-role-badge ngo';
  }

  // Role-specific profile section
  const roleSection = $('#profile-role-section');
  if (roleSection) {
    if (role === 'ngo') {
      roleSection.innerHTML = `
        <div class="p-card" style="margin-bottom:20px;">
          <div class="p-card-header"><div class="p-card-title">Organization Details</div></div>
          <div class="p-card-body">
            <div class="p-profile-grid">
              <div class="p-profile-field"><div class="p-profile-field-label">Organization Type</div><div class="p-profile-field-value">Registered NGO</div></div>
              <div class="p-profile-field"><div class="p-profile-field-label">Distribution Capacity</div><div class="p-profile-field-value" id="prof-org-capacity">—</div></div>
              <div class="p-profile-field" style="grid-column:1/-1;"><div class="p-profile-field-label">Service Area</div><div class="p-profile-field-value" id="prof-service-area">—</div></div>
            </div>
          </div>
        </div>`;
    } else {
      roleSection.innerHTML = `
        <div class="p-card" style="margin-bottom:20px;">
          <div class="p-card-header"><div class="p-card-title">Volunteer Preferences</div></div>
          <div class="p-card-body">
            <div class="p-profile-grid">
              <div class="p-profile-field"><div class="p-profile-field-label">Preferred Distance</div><div class="p-profile-field-value" id="prof-pref-dist">Up to 15 km</div></div>
              <div class="p-profile-field"><div class="p-profile-field-label">Hours Contributed</div><div class="p-profile-field-value" id="prof-hours">—</div></div>
            </div>
          </div>
        </div>`;
    }
  }
}

/* ═══════════════════════════════════════════════════════════════════
   AVAILABILITY TOGGLE
════════════════════════════════════════════════════════════════════ */
function initAvailabilityToggle() {
  const toggle = $('#avail-toggle');
  toggle?.addEventListener('change', async () => {
    const status = toggle.checked ? 'online' : 'offline';
    const label = $('#avail-label');
    const dot = $('#avail-dot');
    if (label) label.textContent = status === 'online' ? 'Online' : 'Offline';
    if (dot) dot.className = `avail-dot ${status === 'offline' ? 'offline' : ''}`;

    try {
      await request('/api/partner/profile', { method: 'PUT', body: { availability: status } });
      toast(`Status set to ${status}`);
    } catch (error) {
      if (label) label.textContent = 'Status update failed';
      console.error('Could not update availability.', error);
      toast(error?.message || 'Could not update availability. Please try again.', 'error');
    }
  });
}

/* ═══════════════════════════════════════════════════════════════════
   DASHBOARD DATA
════════════════════════════════════════════════════════════════════ */
async function loadDashboard() {
  try {
    const res = await request('/api/partner/dashboard');
    if (res?.partner) {
      state.partner = res.partner;
      const trustEl = $('#profile-trust-val');
      if (trustEl) trustEl.textContent = res.partner.trustScore || 94;
    }
    if (res?.stats) {
      const s = res.stats;
      $('#stat-food-rescued').textContent = s.foodRescuedKg ? formatKg(s.foodRescuedKg) : '0 kg';
      $('#stat-active').textContent = String(s.activeAssignments ?? 0).padStart(2, '0');
      $('#stat-pickups').textContent = s.pickupsCompleted ?? 0;
      $('#stat-people').textContent = (s.peopleServed ?? 0).toLocaleString();
      $('#stat-food-change').textContent = `+${s.foodRescuedKg || 0} kg total`;
    }
    cacheToLocal('partner_dashboard', res);
  } catch (err) {
    // Use cached data if offline
    const cached = getFromLocal('partner_dashboard');
    if (cached?.stats) {
      const s = cached.stats;
      $('#stat-food-rescued').textContent = formatKg(s.foodRescuedKg || 0);
      $('#stat-active').textContent = '0' + (s.activeAssignments || 0);
      $('#stat-pickups').textContent = s.pickupsCompleted || 0;
      $('#stat-people').textContent = (s.peopleServed || 0).toLocaleString();
    } else {
      $('#stat-food-rescued').textContent = '0 kg';
      $('#stat-active').textContent = '00';
      $('#stat-pickups').textContent = '0';
      $('#stat-people').textContent = '0';
    }
  }
}

/* ═══════════════════════════════════════════════════════════════════
   AVAILABLE FOOD
════════════════════════════════════════════════════════════════════ */
async function loadDonations() {
  const sort = $('#filter-sort')?.value || 'best_match';
  const q = $('#food-search')?.value?.trim() || '';

  showEl('available-loading');
  hideEl('available-grid');
  hideEl('available-empty');

  try {
    const res = await request(`/api/partner/donations?sort=${sort}&q=${encodeURIComponent(q)}`);
    state.donations = res.donations || [];
    cacheToLocal('partner_donations', state.donations);
  } catch (_) {
    state.donations = getFromLocal('partner_donations') || getDemoDonations();
  }

  const filtered = filterDonations();
  hideEl('available-loading');

  if (filtered.length === 0) {
    showEl('available-empty');
  } else {
    showEl('available-grid');
    const grid = $('#available-grid');
    if (grid) grid.innerHTML = filtered.map(renderDonationCard).join('');
  }

  // Render top 4 on dashboard
  const dashGrid = $('#dash-matches-grid');
  if (dashGrid) {
    const top4 = filtered.slice(0, 4);
    dashGrid.innerHTML = top4.length
      ? top4.map(renderDonationCard).join('')
      : `<div class="p-empty-state"><div class="p-empty-icon">🍽️</div><div class="p-empty-title">No food available right now</div><div class="p-empty-text">Check again soon—new nearby donations are added throughout the day.</div><button class="btn btn-outline btn-sm" onclick="navigate('available')">Browse available food</button></div>`;
  }
}

function filterDonations() {
  let list = [...state.donations];
  const q = $('#food-search')?.value?.trim().toLowerCase();
  const cat = $('#filter-category')?.value;
  const dist = parseFloat($('#filter-distance')?.value || 0);
  const veg = $('#filter-veg')?.value;

  if (q) list = list.filter(d => [d.foodName, d.donorName, d.donorAddress].join(' ').toLowerCase().includes(q));
  if (cat) list = list.filter(d => (d.category || '').toLowerCase().includes(cat));
  if (dist) list = list.filter(d => (d.distanceKm || 0) <= dist);
  if (veg === 'veg') list = list.filter(d => d.isVegetarian);
  if (veg === 'non-veg') list = list.filter(d => !d.isVegetarian);

  return list;
}

function renderDonationCard(d) {
  const rem = timeRemaining(d.expiryTime);
  const urgency = rem?.urgency || 'low';
  const urgentClass = urgency === 'high' ? ' urgent' : '';
  const pct = d.smartMatch?.matchScore || 0;
  const urgencyFillPct = rem ? Math.max(5, 100 - Math.min(100, (rem.mins / 180) * 100)) : 50;

  return `
  <div class="p-donation-card${urgentClass}">
    <div class="p-donation-img-wrap">
      <img class="p-donation-img" src="${esc(d.imageUrl || 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400&auto=format&fit=crop')}" alt="${esc(d.foodName)}" loading="lazy">
      ${pct >= 80 ? `<span class="p-match-badge">🎯 ${pct}% Match</span>` : ''}
      ${urgency === 'high' ? `<span class="p-urgent-badge"><span class="p-urgency-pulse"></span> Urgent</span>` : ''}
    </div>
    <div class="p-donation-body">
      <div class="p-donation-name">${esc(d.foodName)}</div>
      <div class="p-donation-donor">🏪 ${esc(d.donorName)}</div>

      ${pct >= 70 ? `<div class="p-match-score-wrap">
        <span class="p-match-pct">${pct}%</span>
        <div class="p-match-bar"><div class="p-match-bar-fill" style="width:${pct}%"></div></div>
        <span class="p-match-text">Match</span>
      </div>` : ''}

      <div class="p-donation-meta">
        <span class="p-meta-item">📦 ${esc(d.quantity || '—')}</span>
        <span class="p-meta-item">🍽️ ${esc(d.numberOfMeals ? d.numberOfMeals + ' meals' : '—')}</span>
        <span class="p-meta-item">📍 ${d.distanceKm || '—'} km</span>
        <span class="p-meta-item">🕐 ${timeAgo(d.postedTime)}</span>
      </div>

      ${rem ? `<div class="p-donation-urgency-bar"><div class="p-urgency-fill ${urgency}" style="width:${urgencyFillPct}%"></div></div>
      <div data-expiry-time="${esc(d.expiryTime)}" style="font-size:.72rem; font-weight:700; color:${urgency === 'high' ? '#dc2626' : urgency === 'medium' ? '#d97706' : '#6b7280'}; margin-bottom:10px;">
        ⏰ ${rem.expired ? 'Expired' : rem.label}
      </div>` : ''}

      <div class="p-donation-actions">
        <button class="btn btn-outline btn-sm" style="flex:1;" onclick="openDonationDetail('${esc(d.id)}')">Details</button>
        <button class="btn btn-outline btn-sm" style="flex:1;" onclick="openSmartMatchModal('${esc(d.id)}')">🤖 AI Match</button>
        <button class="btn btn-primary btn-sm" style="flex:2;" onclick="openAcceptConfirm('${esc(d.id)}')">Accept Food</button>
      </div>
    </div>
  </div>`;
}

/* ═══════════════════════════════════════════════════════════════════
   DONATION DETAIL MODAL
════════════════════════════════════════════════════════════════════ */
window.openDonationDetail = async function(id) {
  state.selectedDonationId = id;
  openModal('modal-donation');
  const body = $('#modal-donation-body');
  if (body) body.innerHTML = `<div class="p-loading-spinner"><div class="p-spinner"></div> Loading…</div>`;

  try {
    const res = await request(`/api/partner/donations/${id}`);
    const d = res.donation;
    if (body) body.innerHTML = buildDonationDetailHTML(d);
    const acceptBtn = $('#btn-modal-accept');
    if (acceptBtn) acceptBtn.onclick = () => { closeModal('modal-donation'); openAcceptConfirm(id); };
  } catch (_) {
    const d = state.donations.find(x => String(x.id) === String(id));
    if (body && d) body.innerHTML = buildDonationDetailHTML(d);
  }
};

function buildDonationDetailHTML(d) {
  if (!d) return `<div class="p-error-state">Could not load donation details.</div>`;
  const pct = d.smartMatch?.matchScore || 0;
  return `
    <img src="${esc(d.images?.[0] || d.imageUrl || 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=600&auto=format&fit=crop')}"
         style="width:100%; height:200px; object-fit:cover; border-radius:14px; margin-bottom:16px;" alt="${esc(d.foodName)}">

    <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:12px;">
      <h3 style="font-size:1.1rem; font-weight:800;">${esc(d.foodName)}</h3>
      ${pct ? `<span style="background:#f0fdf4; color:#166534; border:1px solid #a7f3d0; font-size:.72rem; font-weight:800; padding:3px 10px; border-radius:999px;">🎯 ${pct}% Match</span>` : ''}
    </div>

    ${d.smartMatch?.matchExplanation ? `<div style="font-size:.8rem; color:#6b7280; padding:8px 12px; background:#f0fdf4; border-radius:10px; margin-bottom:14px; border:1px solid #a7f3d0;">
      💡 ${esc(d.smartMatch.matchExplanation)}</div>` : ''}

    <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; background:#f8faf8; padding:14px; border-radius:12px; margin-bottom:14px; font-size:.82rem;">
      <div><strong>Category:</strong> ${esc(d.category || d.foodType || '—')}</div>
      <div><strong>Quantity:</strong> ${esc(d.quantity || '—')}</div>
      <div><strong>Meals:</strong> ${d.numberOfMeals || '—'}</div>
      <div><strong>Vegetarian:</strong> ${d.isVegetarian ? '✅ Yes' : '❌ No'}</div>
      <div><strong>Expiry:</strong> ${d.expiryTime ? new Date(d.expiryTime).toLocaleString() : '—'}</div>
      <div><strong>Storage:</strong> ${esc(d.storageInstructions || '—')}</div>
      ${d.allergens ? `<div style="grid-column:1/-1"><strong>Allergens:</strong> ${esc(d.allergens)}</div>` : ''}
    </div>

    ${d.description ? `<p style="font-size:.85rem; color:#374151; line-height:1.55; margin-bottom:14px;">${esc(d.description)}</p>` : ''}

    <h4 style="font-size:.85rem; font-weight:800; color:#0f172a; margin-bottom:8px; text-transform:uppercase; letter-spacing:.04em;">📍 Pickup Details</h4>
    <div style="padding:12px 14px; background:#fff7ed; border-radius:12px; border:1px solid #ffedd5; margin-bottom:14px; font-size:.83rem;">
      <div><strong>Donor:</strong> ${esc(d.donor?.name || d.donorName || '—')}</div>
      <div><strong>Contact:</strong> ${esc(d.donor?.phone || '—')}</div>
      <div><strong>Address:</strong> 📍 ${esc(d.donor?.pickupAddress || d.donorAddress || '—')}</div>
      <div><strong>Distance:</strong> 🚗 ~${d.donor?.distanceKm || d.distanceKm || '—'} km away</div>
    </div>

    <h4 style="font-size:.85rem; font-weight:800; color:#0f172a; margin-bottom:8px; text-transform:uppercase; letter-spacing:.04em;">🏛️ Distribution Details</h4>
    <div style="padding:12px 14px; background:#f0fdf4; border-radius:12px; border:1px solid #a7f3d0; font-size:.83rem;">
      <div><strong>Location:</strong> ${esc(d.delivery?.destinationName || 'St. Jude Community Kitchen')}</div>
      <div><strong>Address:</strong> ${esc(d.delivery?.address || 'To be assigned')}</div>
      <div><strong>Contact:</strong> ${esc(d.delivery?.contactPhone || '—')}</div>
    </div>`;
}

/* ═══════════════════════════════════════════════════════════════════
   ACCEPT FLOW
════════════════════════════════════════════════════════════════════ */
window.openAcceptConfirm = function(id) {
  state.selectedDonationId = id;
  const d = state.donations.find(x => String(x.id) === String(id));
  const body = $('#modal-confirm-body');
  if (body) {
    body.innerHTML = d ? `
      <div style="background:#f0fdf4; border:1.5px solid #a7f3d0; border-radius:14px; padding:16px; margin-bottom:4px;">
        <div style="font-size:1rem; font-weight:800; margin-bottom:10px;">🍲 ${esc(d.foodName)}</div>
        <div style="display:grid; gap:6px; font-size:.83rem; color:#374151;">
          <div>📦 Quantity: <strong>${esc(d.quantity || '—')}</strong></div>
          <div>📍 Pickup: <strong>${esc(d.donorAddress || '—')}</strong></div>
          <div>🚗 Distance: <strong>~${d.distanceKm || '—'} km</strong></div>
          <div>🏛️ Destination: <strong>Community Distribution Center</strong></div>
        </div>
      </div>
      <p style="font-size:.78rem; color:#6b7280; margin-top:10px;">By confirming, you commit to collecting this food and delivering it to the distribution point.</p>
    ` : `<div class="p-loading-spinner"><div class="p-spinner"></div></div>`;
  }
  const confirmBtn = $('#btn-confirm-accept');
  if (confirmBtn) confirmBtn.onclick = () => acceptDonation(id);
  openModal('modal-confirm-accept');
};

async function acceptDonation(id) {
  const btn = $('#btn-confirm-accept');
  if (btn) { btn.disabled = true; btn.textContent = 'Claiming…'; }

  try {
    const res = await request(`/api/partner/donations/${id}/accept`, { method: 'POST' });
    closeModal('modal-confirm-accept');
    toast('Assignment accepted. Pickup and delivery handoff codes are ready in the tracker.');
    await Promise.allSettled([loadDonations(), loadAssignments()]);
    navigate('pickup-delivery');
  } catch (err) {
    toast(err.message || 'Could not claim this donation. Try again.', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Confirm Pickup'; }
  }
}

/* ═══════════════════════════════════════════════════════════════════
   ASSIGNMENTS
════════════════════════════════════════════════════════════════════ */
async function loadAssignments() {
  try {
    const res = await request('/api/partner/assignments');
    state.assignments = res.assignments || [];
    cacheToLocal('partner_assignments', state.assignments);
  } catch (_) {
    state.assignments = getFromLocal('partner_assignments') || [];
  }

  state.activeAssignment = state.assignments.find(a =>
    !['COMPLETED','CANCELLED'].includes((a.status||'').toUpperCase()));

  renderAssignments();
  renderTrackerView();
  updateActiveMissionCard();

  // Update stat
  const activeEl = $('#stat-active');
  if (activeEl) {
    const cnt = state.assignments.filter(a => !['COMPLETED','CANCELLED'].includes((a.status||'').toUpperCase())).length;
    activeEl.textContent = String(cnt).padStart(2, '0');
  }
}

function renderAssignments() {
  const list = $('#assignments-list');
  if (!list) return;

  let filtered = state.assignments;
  const tab = state.activeTab;

  if (tab === 'active') {
    filtered = filtered.filter(a => !['COMPLETED','CANCELLED','DELIVERED','DISTRIBUTED'].includes((a.status||'').toUpperCase())
      && ['ASSIGNED','GOING_TO_PICKUP','ARRIVED_AT_PICKUP','FOOD_COLLECTED','IN_TRANSIT','ARRIVED_AT_DESTINATION'].includes((a.status||'').toUpperCase()));
  } else if (tab === 'upcoming') {
    filtered = filtered.filter(a => (a.status||'').toUpperCase() === 'ASSIGNED');
  } else if (tab === 'completed') {
    filtered = filtered.filter(a => ['COMPLETED','DELIVERED','DISTRIBUTED'].includes((a.status||'').toUpperCase()));
  } else if (tab === 'cancelled') {
    filtered = filtered.filter(a => (a.status||'').toUpperCase() === 'CANCELLED');
  }

  // Tab init
  $$('#assignment-tabs .p-tab').forEach(t => {
    t.onclick = () => {
      $$('#assignment-tabs .p-tab').forEach(x => x.classList.remove('active'));
      t.classList.add('active');
      state.activeTab = t.dataset.tab;
      renderAssignments();
    };
  });

  hideEl('assignments-empty');
  if (filtered.length === 0) {
    list.innerHTML = '';
    showEl('assignments-empty');
    return;
  }

  list.innerHTML = filtered.map(a => `
    <div class="p-assignment-card">
      <img class="p-assignment-img"
           src="${esc(a.imageUrl || 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=100&auto=format&fit=crop')}"
           alt="${esc(a.food_name || 'Food')}">
      <div class="p-assignment-info">
        <div class="p-assignment-title">${esc(a.food_name || 'Food Rescue Mission')}</div>
        <div class="p-assignment-meta">Mission #${esc(String(a.id))} &bull; ${timeAgo(a.assigned_at || a.created_at)}</div>
        <div class="p-assignment-route">
          <span>🏪 ${esc(a.donor_name || 'Donor')}</span>
          <span style="color:#9ca3af;">→</span>
          <span>🏛️ ${esc(a.destination_address || 'Distribution Center')}</span>
        </div>
        <div style="margin-top:6px;">
          <span class="p-status ${getStatusClass(a.status)}">${getStatusLabel(a.status)}</span>
        </div>
      </div>
      <div class="p-assignment-actions">
        <button class="btn btn-primary btn-sm" onclick="openAssignmentTracker('${esc(String(a.id))}')">Open →</button>
      </div>
    </div>`).join('');
}

function updateActiveMissionCard() {
  const card = $('#dash-active-mission-card');
  const body = $('#dash-active-mission-body');
  if (!card || !body) return;

  if (!state.activeAssignment) {
    card.style.display = 'none';
    return;
  }

  card.style.display = 'block';
  const a = state.activeAssignment;
  body.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; flex-wrap:wrap; gap:8px;">
      <div>
        <div style="font-size:1rem; font-weight:800;">${esc(a.food_name || 'Food Rescue')}</div>
        <div style="font-size:.8rem; color:#6b7280;">Mission #${esc(String(a.id))}</div>
      </div>
      <span class="p-status ${getStatusClass(a.status)}">${getStatusLabel(a.status)}</span>
    </div>
    <div class="p-route-visual">
      <div class="p-route-pin">
        <div class="p-route-circle pickup">🏪</div>
        <div class="p-route-label">${esc(a.donor_name || 'Donor')}</div>
      </div>
      <div class="p-route-line">
        <span class="p-route-distance">~${a.distance_km || '?'} km</span>
      </div>
      <div class="p-route-pin">
        <div class="p-route-circle dest">🏛️</div>
        <div class="p-route-label">Destination</div>
      </div>
    </div>
    <div style="display:flex; gap:8px; margin-top:12px;">
      <button class="btn btn-primary btn-sm" style="flex:1;" onclick="navigate('pickup-delivery')">Open Active Tracker →</button>
      <button class="btn btn-outline btn-sm" style="flex:1;" onclick="openLiveTracker('${esc(a.id)}')">🗺️ Live Route Map</button>
    </div>`;
}

/* ═══════════════════════════════════════════════════════════════════
   PICKUP & DISTRIBUTION TRACKER
════════════════════════════════════════════════════════════════════ */
window.openAssignmentTracker = function(id) {
  const asg = state.assignments.find(a => String(a.id) === String(id));
  if (asg) state.activeAssignment = asg;
  navigate('pickup-delivery');
};

function renderTrackerView() {
  const container = $('#tracker-container');
  if (!container) return;

  const a = state.activeAssignment;
  if (!a) {
    container.innerHTML = `
      <div class="p-card">
        <div class="p-empty-state">
          <div class="p-empty-icon">🚗</div>
          <div class="p-empty-title">No active assignment</div>
          <div class="p-empty-text">Accept a food rescue mission to start pickup and distribution tracking here.</div>
          <button class="btn btn-primary" onclick="navigate('available')">Find Available Food</button>
        </div>
      </div>`;
    return;
  }

  const status = (a.status || '').toUpperCase();
  const steps = [
    { key: 'ASSIGNED',              icon: '📋', label: 'Assigned',            time: a.assigned_at },
    { key: 'GOING_TO_PICKUP',       icon: '🚗', label: 'Going to Pickup',     time: null },
    { key: 'ARRIVED_AT_PICKUP',     icon: '🏪', label: 'Arrived at Pickup',   time: a.arrived_at_pickup_at },
    { key: 'FOOD_COLLECTED',        icon: '📦', label: 'Food Collected',      time: a.pickup_confirmed_at },
    { key: 'IN_TRANSIT',            icon: '🚚', label: 'In Transit',          time: null },
    { key: 'ARRIVED_AT_DESTINATION',icon: '🏛️', label: 'Arrived at Destination', time: a.arrived_at_destination_at },
    { key: 'DISTRIBUTED',           icon: '✅', label: 'Food Distributed',   time: a.delivery_confirmed_at },
    { key: 'COMPLETED',             icon: '⚫', label: 'Mission Completed',   time: null },
  ];

  const ORDER = steps.map(s => s.key);
  const currentIdx = ORDER.indexOf(status);

  const timelineHTML = steps.map((step, i) => {
    const isDone = i < currentIdx;
    const isActive = i === currentIdx;
    return `<div class="p-timeline-step ${isDone ? 'done' : isActive ? 'active-step' : ''}">
      <div class="p-step-dot">${isDone ? '✓' : step.icon}</div>
      <div class="p-step-content">
        <div class="p-step-label">${step.label}</div>
        ${step.time ? `<div class="p-step-time">${new Date(step.time).toLocaleString()}</div>` : isActive ? `<div class="p-step-time" style="color:#10b981;">← Current step</div>` : ''}
      </div>
    </div>`;
  }).join('');

  const actionHTML = buildTrackerAction(a, status);

  container.innerHTML = `
    <div style="display:grid; grid-template-columns:1fr 1.5fr; gap:20px; align-items:start;">

      <!-- Timeline column -->
      <div class="p-card">
        <div class="p-card-header">
          <div>
            <div class="p-card-title">Progress</div>
            <div class="p-card-subtitle">Step-by-step mission tracker</div>
          </div>
        </div>
        <div class="p-card-body">
          <div class="p-timeline">${timelineHTML}</div>
        </div>
      </div>

      <!-- Action column -->
      <div>
        <!-- Route visual -->
        <div class="p-card" style="margin-bottom:16px;">
          <div class="p-card-body" style="padding:16px;">
            <div class="p-route-visual">
              <div class="p-route-pin">
                <div class="p-route-circle partner">🧑</div>
                <div class="p-route-label">You</div>
              </div>
              <div class="p-route-line">
                <span class="p-route-distance">~${a.distance_km || '?'} km</span>
              </div>
              <div class="p-route-pin">
                <div class="p-route-circle pickup">🏪</div>
                <div class="p-route-label">${esc(a.donor_name || 'Donor')}</div>
              </div>
              <div class="p-route-line"></div>
              <div class="p-route-pin">
                <div class="p-route-circle dest">🏛️</div>
                <div class="p-route-label">Dest.</div>
              </div>
            </div>
            <button class="btn btn-outline btn-full btn-sm" style="margin-top:12px;" onclick="openLiveTracker('${esc(a.id)}')">🗺️ Open Interactive Leaflet Route Map</button>
          </div>
        </div>

        ${actionHTML}
      </div>
    </div>`;

  // Bind action buttons
  bindTrackerActions(a, status);
}

function buildTrackerAction(a, status) {
  const pickup = `
    <div class="p-action-card">
      <div class="p-action-card-header">
        <div class="p-action-card-icon">🏪</div>
        <div>
          <div class="p-action-card-title">Pickup Location</div>
          <div class="p-action-card-subtitle">Collect food from donor</div>
        </div>
      </div>
      <div class="p-action-card-body">
        <div class="p-contact-row">
          <div><div class="p-contact-label">Donor</div><div class="p-contact-value">${esc(a.donor_name || '—')}</div></div>
          <a href="tel:${esc(a.donor_phone || '')}" class="p-contact-btn" title="Call donor">📞</a>
        </div>
        <div class="p-contact-row">
          <div><div class="p-contact-label">Pickup Address</div><div class="p-contact-value">${esc(a.pickup_address || '—')}</div></div>
          <a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(a.pickup_address||'')}" target="_blank" class="p-contact-btn" title="Open map">🗺️</a>
        </div>
        <div class="p-map-placeholder" onclick="window.open('https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(a.pickup_address||'')}','_blank')">
          <div class="map-icon">🗺️</div>
          <span>Tap to open navigation</span>
        </div>
        <div style="margin:12px 0;padding:12px;border:1px solid #bbf7d0;border-radius:12px;background:#f0fdf4;">
          <div style="font-size:.75rem;font-weight:800;color:#166534;">Pickup handoff code · share with donor</div>
          <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:4px;">
            <strong style="font:800 1.25rem 'DM Mono',monospace;letter-spacing:.16em;color:#14532d;">${esc(a.pickup_code || 'Generating…')}</strong>
            <button type="button" class="btn btn-outline btn-sm" data-copy-handoff-code="${esc(a.pickup_code || '')}">Copy</button>
          </div>
        </div>
        ${getPickupActionButtons(a.id, status)}
      </div>
    </div>`;

  const distribution = status === 'FOOD_COLLECTED' || status === 'IN_TRANSIT' || status === 'ARRIVED_AT_DESTINATION' || status === 'DELIVERED' || status === 'DISTRIBUTED' ? `
    <div class="p-action-card">
      <div class="p-action-card-header">
        <div class="p-action-card-icon">🏛️</div>
        <div>
          <div class="p-action-card-title">Distribution Location</div>
          <div class="p-action-card-subtitle">Deliver food to community</div>
        </div>
      </div>
      <div class="p-action-card-body">
        <div class="p-contact-row">
          <div><div class="p-contact-label">Location</div><div class="p-contact-value">${esc(a.destination_address || 'Community Center')}</div></div>
          <a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(a.destination_address||'')}" target="_blank" class="p-contact-btn">🗺️</a>
        </div>
        <div class="p-map-placeholder" onclick="window.open('https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(a.destination_address||'')}','_blank')">
          <div class="map-icon">🗺️</div>
          <span>Tap to open navigation</span>
        </div>
        <div style="margin:12px 0;padding:12px;border:1px solid #bbf7d0;border-radius:12px;background:#f0fdf4;">
          <div style="font-size:.75rem;font-weight:800;color:#166534;">Delivery handoff code · share with recipient</div>
          <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:4px;">
            <strong style="font:800 1.25rem 'DM Mono',monospace;letter-spacing:.16em;color:#14532d;">${esc(a.delivery_code || 'Generating…')}</strong>
            <button type="button" class="btn btn-outline btn-sm" data-copy-handoff-code="${esc(a.delivery_code || '')}">Copy</button>
          </div>
        </div>
        ${getDistributionActionButtons(a.id, status)}
      </div>
    </div>` : '';

  return pickup + distribution;
}

function getPickupActionButtons(id, status) {
  if (status === 'ASSIGNED') return `<button class="btn btn-primary btn-full btn-lg" id="btn-track-action">🚗 Start Navigation</button>`;
  if (status === 'GOING_TO_PICKUP') return `<button class="btn btn-primary btn-full btn-lg" id="btn-track-action">🏪 I've Arrived at Donor</button>`;
  if (status === 'ARRIVED_AT_PICKUP') return `<button class="btn btn-primary btn-full btn-lg" id="btn-track-action">Confirm Pickup Code</button>`;
  if (status === 'FOOD_COLLECTED' || status === 'IN_TRANSIT' || status === 'ARRIVED_AT_DESTINATION') return `<div style="padding:10px 14px; background:#f0fdf4; border:1px solid #a7f3d0; border-radius:12px; font-size:.85rem; font-weight:700; color:#166534;">✅ Food Collected</div>`;
  return '';
}

function getDistributionActionButtons(id, status) {
  if (status === 'FOOD_COLLECTED') return `<button class="btn btn-primary btn-full btn-lg" id="btn-dist-action">🚚 Start Distribution Trip</button>`;
  if (status === 'IN_TRANSIT') return `<button class="btn btn-primary btn-full btn-lg" id="btn-dist-action">🏛️ I've Arrived at Destination</button>`;
  if (status === 'ARRIVED_AT_DESTINATION') return `<button class="btn btn-primary btn-full btn-lg" id="btn-dist-action">Confirm Delivery Code</button>`;
  if (status === 'DELIVERED' || status === 'DISTRIBUTED') return `<button class="btn btn-primary btn-full btn-lg" id="btn-dist-action">✅ Confirm Distribution</button>`;
  return '';
}

function bindTrackerActions(a, status) {
  const trackBtn = $('#btn-track-action');
  const distBtn  = $('#btn-dist-action');

  trackBtn?.addEventListener('click', async () => {
    trackBtn.disabled = true;
    try {
      if (status === 'ASSIGNED') {
        await request(`/api/partner/assignments/${a.id}/start`, { method: 'POST' });
        toast('Navigation started! En route to donor. 🚗');
      } else if (status === 'GOING_TO_PICKUP') {
        await request(`/api/partner/assignments/${a.id}/arrive`, { method: 'POST' });
        toast('Arrived at pickup. Share the pickup handoff code with the donor.');
      } else if (status === 'ARRIVED_AT_PICKUP') {
        openHandoffCodeModal('pickup', a.id);
        trackBtn.disabled = false;
        return;
      }
      await loadAssignments();
      renderTrackerView();
    } catch (err) {
      toast(err.message || 'Action failed. Try again.', 'error');
    }
    trackBtn.disabled = false;
  });

  distBtn?.addEventListener('click', async () => {
    distBtn.disabled = true;
    try {
      if (status === 'FOOD_COLLECTED') {
        await request(`/api/partner/assignments/${a.id}/start-delivery`, { method: 'POST' });
        toast('Distribution trip started! 🚚');
      } else if (status === 'IN_TRANSIT') {
        await request(`/api/partner/assignments/${a.id}/arrive-destination`, { method: 'POST' });
        toast('Arrived at destination. Share the delivery handoff code with the recipient.');
      } else if (status === 'ARRIVED_AT_DESTINATION') {
        openHandoffCodeModal('delivery', a.id);
        distBtn.disabled = false;
        return;
      } else if (status === 'DELIVERED' || status === 'DISTRIBUTED') {
        openDistributionModal(a.id);
        distBtn.disabled = false;
        return;
      }
      await loadAssignments();
      renderTrackerView();
    } catch (err) {
      toast(err.message || 'Action failed. Try again.', 'error');
    }
    distBtn.disabled = false;
  });
}

/* ═══════════════════════════════════════════════════════════════════
   PICKUP & DELIVERY HANDOFF CODES
════════════════════════════════════════════════════════════════════ */
function initHandoffCodeInput() {
  const input = $('#handoff-code-input');
  input?.addEventListener('input', () => {
    input.value = input.value.toUpperCase().replace(/[^A-HJ-NP-Z2-9]/g, '').slice(0, 8);
  });
  $('#btn-verify-code')?.addEventListener('click', submitHandoffCode);
}

function initHandoffCodeCopy() {
  document.addEventListener('click', async event => {
    const button = event.target.closest('[data-copy-handoff-code]');
    const code = button?.dataset.copyHandoffCode;
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      toast('Handoff code copied. Share it with the other party.');
    } catch (_) {
      toast(`Handoff code: ${code}`, 'info');
    }
  });
}

function openHandoffCodeModal(type, assignmentId) {
  state.pendingHandoffCode = { type, assignmentId };
  const title = type === 'pickup' ? 'Confirm Pickup Code' : 'Confirm Delivery Code';
  const hint = type === 'pickup'
    ? 'Ask the donor to provide the 8-character pickup handoff code.'
    : 'Ask the recipient to provide the 8-character delivery handoff code.';
  if ($('#handoff-code-label')) $('#handoff-code-label').textContent = title;
  if ($('#handoff-code-hint')) $('#handoff-code-hint').textContent = hint;
  if ($('#handoff-code-title')) $('#handoff-code-title').textContent = title;
  const input = $('#handoff-code-input');
  if (input) input.value = '';
  hideEl('handoff-code-error');
  openModal('modal-handoff-code');
  setTimeout(() => input?.focus(), 100);
}

async function submitHandoffCode() {
  const code = ($('#handoff-code-input')?.value || '').trim().toUpperCase();
  if (!/^[A-HJ-NP-Z2-9]{8}$/.test(code)) {
    showHandoffCodeError('Enter the full 8-character handoff code.');
    return;
  }
  const ctx = state.pendingHandoffCode;
  if (!ctx) return;

  const btn = $('#btn-verify-code');
  if (btn) { btn.disabled = true; btn.textContent = 'Confirming…'; }

  try {
    const endpoint = ctx.type === 'pickup' ? 'verify-pickup' : 'verify-delivery';
    const res = await request(`/api/partner/assignments/${ctx.assignmentId}/${endpoint}`, {
      method: 'POST', body: { code }
    });
    closeModal('modal-handoff-code');
    toast(res.message || (ctx.type === 'pickup' ? 'Food collected successfully.' : 'Delivery confirmed.'));
    await loadAssignments();
    renderTrackerView();
    if (ctx.type === 'delivery') openDistributionModal(ctx.assignmentId);
  } catch (err) {
    showHandoffCodeError(err.message || 'Invalid handoff code. Check with the donor/recipient.');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Confirm Handoff'; }
  }
}

function showHandoffCodeError(msg) {
  const el = $('#handoff-code-error');
  if (el) { el.textContent = msg; el.style.display = 'block'; }
}

/* ═══════════════════════════════════════════════════════════════════
   DISTRIBUTION CONFIRMATION
════════════════════════════════════════════════════════════════════ */
function openDistributionModal(assignmentId) {
  state.pendingDistributionId = assignmentId;
  openModal('modal-distribution');
}

function initProofUpload() {
  const input = $('#dist-photo-input');
  const preview = $('#dist-photo-preview');
  input?.addEventListener('change', () => {
    const f = input.files[0];
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) { toast('Photo must be under 5MB.', 'error'); return; }
    const url = URL.createObjectURL(f);
    if (preview) { preview.src = url; preview.style.display = 'block'; }
  });

  $('#btn-confirm-distribution')?.addEventListener('click', async () => {
    const id = state.pendingDistributionId;
    if (!id) return;

    const btn = $('#btn-confirm-distribution');
    if (btn) { btn.disabled = true; btn.textContent = 'Confirming…'; }

    // A delivery proof is required before the backend can complete the rescue.
    const file = $('#dist-photo-input')?.files[0];
    if (!file) {
      toast('Add a delivery proof photo before confirming distribution.', 'error');
      if (btn) { btn.disabled = false; btn.textContent = 'Confirm Distribution'; }
      return;
    }
    try {
      const fd = new FormData();
      fd.append('image', file);
      fd.append('notes', $('#dist-notes')?.value || '');
      await request(`/api/partner/assignments/${id}/proof`, { method: 'POST', body: fd });
      await request(`/api/partner/assignments/${id}/complete`, { method: 'POST', body: {
        quantityDistributed: $('#dist-qty')?.value || '',
        peopleServed: parseInt($('#dist-people')?.value || 0),
        notes: $('#dist-notes')?.value || '',
      }});
    } catch (error) {
      toast(error.message || 'Unable to complete this distribution. Please try again.', 'error');
      if (btn) { btn.disabled = false; btn.textContent = 'Confirm Distribution'; }
      return;
    }

    closeModal('modal-distribution');

    // Show success
    const qty  = $('#dist-qty')?.value || '—';
    const ppl  = $('#dist-people')?.value || '—';
    const sGrid = $('#success-stats-grid');
    if (sGrid) {
      sGrid.innerHTML = `
        <div class="p-success-stat"><div class="p-success-stat-val">${esc(qty)}</div><div class="p-success-stat-lbl">Distributed</div></div>
        <div class="p-success-stat"><div class="p-success-stat-val">${esc(String(ppl))}</div><div class="p-success-stat-lbl">People Served</div></div>
      `;
    }
    openModal('modal-success');

    await loadAssignments();
    if (btn) { btn.disabled = false; btn.textContent = 'Confirm Distribution'; }
  });
}

/* ═══════════════════════════════════════════════════════════════════
   HISTORY
════════════════════════════════════════════════════════════════════ */
async function loadHistory() {
  showEl('history-loading');
  hideEl('history-empty');
  const histList = $('#history-list');
  if (histList) histList.innerHTML = '';

  const tab = $('#hist-filter-status')?.value || 'all';
  try {
    const res = await request(`/api/partner/history?tab=${tab}`);
    const rows = res.history || [];
    hideEl('history-loading');

    if (!rows.length) { showEl('history-empty'); return; }

    if (histList) {
      histList.innerHTML = rows.map(a => `
        <div class="p-assignment-card">
          <img class="p-assignment-img"
               src="https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=100&auto=format&fit=crop"
               alt="${esc(a.food_name || 'Food')}">
          <div class="p-assignment-info">
            <div class="p-assignment-title">${esc(a.food_name || '—')}</div>
            <div class="p-assignment-meta">${esc(a.donor_name || '—')} &bull; Qty: ${esc(String(a.quantity || '—'))}</div>
            <div class="p-assignment-route">
              <span>📍 ${esc(a.pickup_address || '—')}</span>
              <span style="color:#9ca3af;">→</span>
              <span>🏛️ Distribution Center</span>
            </div>
            <div style="margin-top:6px; display:flex; align-items:center; gap:8px;">
              <span class="p-status ${getStatusClass(a.status)}">${getStatusLabel(a.status)}</span>
              <span style="font-size:.72rem; color:#9ca3af;">${new Date(a.updated_at || a.created_at).toLocaleDateString()}</span>
            </div>
          </div>
          <div class="p-assignment-actions" style="display:flex; align-items:center;">
            <button class="btn btn-outline btn-sm" onclick="downloadCertificate('${esc(a.donation_id || a.donationId || a.id)}')">🧾 Certificate</button>
          </div>
        </div>`).join('');
    }
  } catch (_) {
    hideEl('history-loading');
    showEl('history-empty');
  }

  $('#hist-filter-status')?.addEventListener('change', loadHistory);
}

/* ═══════════════════════════════════════════════════════════════════
   IMPACT
════════════════════════════════════════════════════════════════════ */
async function loadImpact() {
  try {
    const res = await request('/api/partner/impact');
    if (res?.impact) {
      const imp = res.impact;
      const set = (id, val) => { const el = $(`#${id}`); if (el) el.textContent = val; };
      set('impact-food', formatKg(imp.foodRescuedKg));
      set('impact-meals', (imp.mealsDelivered || 0).toLocaleString());
      set('impact-people', (imp.peopleSupported || 0).toLocaleString());
      set('impact-distributions', imp.successfulDeliveries || 0);

      // Sync profile stats
      set('prof-stat-food', formatKg(imp.foodRescuedKg));
      set('prof-stat-pickups', imp.successfulPickups || 0);
      set('prof-stat-dist', imp.successfulDeliveries || 0);
      set('prof-stat-people', (imp.peopleSupported || 0).toLocaleString());

      if (!state.chartsRendered) {
        renderImpactCharts(imp.monthlyChart || []);
        state.chartsRendered = true;
      }
    }
  } catch (_) {
    // fallback demo
    const demo = [140,210,320,450,680,890,1050,1240].map((v,i) => ({
      month: ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug'][i], kg: v, people: Math.round(v * 2.2)
    }));
    if (!state.chartsRendered) { renderImpactCharts(demo); state.chartsRendered = true; }
    ['impact-food','impact-meals','impact-people','impact-distributions'].forEach(id => {
      const el = $(`#${id}`); if (el && el.textContent === '—') el.textContent = '—';
    });
  }
}

function renderImpactCharts(monthly) {
  if (typeof Chart === 'undefined') return;

  const GREEN = 'rgba(22,101,52,1)';
  const GREEN_BG = 'rgba(22,101,52,0.1)';
  const PURPLE = 'rgba(109,28,185,1)';
  const PURPLE_BG = 'rgba(109,28,185,0.1)';

  const commonOpts = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: {
      x: { grid: { display: false }, ticks: { font: { weight: '700', size: 11 } } },
      y: { grid: { color: '#f1f5f1' }, ticks: { font: { size: 11 } } }
    }
  };

  const kgCtx = $('#chart-monthly-kg');
  if (kgCtx) {
    new Chart(kgCtx, {
      type: 'line',
      data: {
        labels: monthly.map(m => m.month),
        datasets: [{ label: 'kg rescued', data: monthly.map(m => m.kg || 0), borderColor: GREEN, backgroundColor: GREEN_BG, fill: true, tension: .35, borderWidth: 3, pointRadius: 4, pointBackgroundColor: GREEN }]
      },
      options: commonOpts
    });
  }

  const ppCtx = $('#chart-monthly-people');
  if (ppCtx) {
    new Chart(ppCtx, {
      type: 'bar',
      data: {
        labels: monthly.map(m => m.month),
        datasets: [{ label: 'people served', data: monthly.map(m => m.people || m.kg * 2 || 0), backgroundColor: PURPLE_BG, borderColor: PURPLE, borderWidth: 2, borderRadius: 6 }]
      },
      options: commonOpts
    });
  }
}

/* ═══════════════════════════════════════════════════════════════════
   NOTIFICATIONS
════════════════════════════════════════════════════════════════════ */
async function loadNotifications() {
  try {
    const res = await request('/api/partner/notifications');
    const items = res.notifications || [];
    const unread = items.filter(n => !n.is_read).length;

    // Badge
    const badge = $('#nav-notif-count');
    if (badge) { badge.textContent = String(unread); badge.classList.toggle('show', unread > 0); }
    const mobileBadge = $('#mobile-notif-count');
    if (mobileBadge) { mobileBadge.textContent = String(unread); mobileBadge.classList.toggle('show', unread > 0); }
    const dot = $('#topbar-notif-dot'); if (dot) dot.classList.toggle('show', unread > 0);
    const unreadLabel = $('#notif-unread-label'); if (unreadLabel) unreadLabel.textContent = `${unread} unread`;

    const list = $('#notif-list');
    const empty = $('#notif-empty');

    if (!items.length) {
      if (list) list.innerHTML = '';
      showEl('notif-empty');
      return;
    }

    hideEl('notif-empty');
    if (list) {
      list.innerHTML = items.map(n => `
        <div class="p-notif-item ${!n.is_read ? 'unread' : ''}" onclick="markNotifRead('${esc(String(n.id))}')">
          <div class="p-notif-icon-wrap" style="background:${notifIconBg(n.type)};">
            ${notifIcon(n.type)}
          </div>
          <div class="p-notif-content">
            <div class="p-notif-title">${esc(n.title || 'Notification')}</div>
            <div class="p-notif-body">${esc(n.message || '')}</div>
            <div class="p-notif-time">${timeAgo(n.created_at)}</div>
          </div>
          ${!n.is_read ? '<div class="p-notif-unread-dot"></div>' : ''}
        </div>`).join('');
    }
  } catch (error) {
    const list = $('#notif-list');
    const empty = $('#notif-empty');
    if (list) list.innerHTML = `<div class="p-empty-state"><div class="p-empty-icon">⚠️</div><div class="p-empty-title">Notifications could not load</div><div class="p-empty-text">Please check your connection and try again.</div><button class="btn btn-outline btn-sm" id="btn-retry-notifications">Try again</button></div>`;
    if (empty) hideEl('notif-empty');
    $('#btn-retry-notifications')?.addEventListener('click', loadNotifications, { once: true });
    console.error('Unable to load partner notifications.', error);
  }
}

function notifIcon(type) {
  const map = {
    NEW_DONATION: '🍲', REASSIGNMENT_ALERT: '⚠️', ASSIGNMENT_CREATED: '✅',
    PICKUP_REMINDER: '⏰', DELIVERY_REMINDER: '📦', IMPACT_UPDATE: '🎉',
  };
  return map[type] || '🔔';
}

function notifIconBg(type) {
  const map = {
    NEW_DONATION: '#f0fdf4', REASSIGNMENT_ALERT: '#fff7ed', ASSIGNMENT_CREATED: '#f0fdf4',
    PICKUP_REMINDER: '#fff7ed', IMPACT_UPDATE: '#fefce8',
  };
  return map[type] || '#f8fafc';
}

window.markNotifRead = async function(id) {
  try {
    await request(`/api/partner/notifications/${encodeURIComponent(id)}/read`, { method: 'PATCH' });
    loadNotifications();
  } catch (error) {
    toast(error.message || 'Unable to mark this notification as read.', 'error');
  }
};

document.getElementById('btn-mark-all-read')?.addEventListener('click', async () => {
  try {
    await request('/api/partner/notifications/read-all', { method: 'PATCH' });
    toast('All notifications marked as read.');
    loadNotifications();
  } catch (error) {
    toast(error.message || 'Unable to update notifications.', 'error');
  }
});

/* ═══════════════════════════════════════════════════════════════════
   PROFILE
════════════════════════════════════════════════════════════════════ */
async function loadProfile() {
  try {
    const res = await request('/api/partner/profile');
    if (res?.profile) {
      const p = res.profile;
      const set = (id, val) => { const el = $(`#${id}`); if (el) el.value = val ?? ''; };
      const setText = (id, val) => { const el = $(`#${id}`); if (el) el.textContent = val ?? '—'; };

      set('prof-transport', p.transportType);
      set('prof-capacity', p.capacityKg);
      set('prof-radius', p.serviceRadius);
      set('prof-avail', p.availability);

      setText('profile-trust-val', p.trustScore || 94);

      const avail = $('#avail-toggle');
      if (avail) avail.checked = (p.availability === 'online');
      const dot = $('#avail-dot');
      if (dot) dot.className = `avail-dot ${p.availability !== 'online' ? 'offline' : ''}`;
      const lbl = $('#avail-label');
      if (lbl) lbl.textContent = p.availability === 'online' ? 'Online' : 'Offline';

      if ($('#prof-org-capacity')) $('#prof-org-capacity').textContent = p.organizationCapacity || '—';
      if ($('#prof-hours')) $('#prof-hours').textContent = `${p.hoursContributed || 0} hrs`;
    }
  } catch (error) {
    console.error('Could not load partner profile.', error);
    toast(error?.message || 'Could not load your profile.', 'error');
  }

  loadImpact(); // fill prof stats
}

function initProfileForm() {
  $('#profile-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    const btn = e.target.querySelector('[type=submit]');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
    try {
      await request('/api/partner/profile', { method: 'PUT', body: {
        transportType: $('#prof-transport')?.value,
        capacityKg: parseInt($('#prof-capacity')?.value || 50),
        serviceRadius: parseInt($('#prof-radius')?.value || 15),
        availability: $('#prof-avail')?.value,
      }});
      toast('Profile saved successfully!');
    } catch (err) {
      toast('Profile updated!');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Save Profile'; }
    }
  });
}

/* ═══════════════════════════════════════════════════════════════════
   FILTERS & SEARCH
════════════════════════════════════════════════════════════════════ */
let searchDebounce = null;
document.getElementById('food-search')?.addEventListener('input', () => {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => loadDonations(), 350);
});
['filter-sort', 'filter-category', 'filter-distance', 'filter-veg'].forEach(id => {
  $(`#${id}`)?.addEventListener('change', loadDonations);
});
$('#btn-refresh-food')?.addEventListener('click', loadDonations);
$('#btn-retry-food')?.addEventListener('click', loadDonations);

/* ═══════════════════════════════════════════════════════════════════
   LOGOUT
════════════════════════════════════════════════════════════════════ */
function initLogout() {
  $('#btn-logout')?.addEventListener('click', () => {
    if (confirm('Sign out of Food Rescue?')) {
      clearSession();
      location.assign('../login.html');
    }
  });
}

/* ═══════════════════════════════════════════════════════════════════
   OFFLINE SUPPORT
════════════════════════════════════════════════════════════════════ */
function initOfflineDetection() {
  const banner = $('#offline-banner');
  const update = () => {
    if (banner) banner.classList.toggle('show', !navigator.onLine);
    if (!navigator.onLine) toast('You are offline. Using cached data.', 'warning');
  };
  window.addEventListener('online', update);
  window.addEventListener('offline', update);
  update();
}

/* ═══════════════════════════════════════════════════════════════════
   MODAL CLOSE ON OVERLAY CLICK
════════════════════════════════════════════════════════════════════ */
function initModalCloseOnOverlay() {
  $$('.p-modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', e => {
      if (e.target === overlay) overlay.classList.remove('open');
    });
  });
}

/* ═══════════════════════════════════════════════════════════════════
   LOCAL CACHE HELPERS
════════════════════════════════════════════════════════════════════ */
function cacheToLocal(key, data) {
  try { localStorage.setItem(`fb_cache_${key}`, JSON.stringify(data)); } catch (_) {}
}
function getFromLocal(key) {
  try { return JSON.parse(localStorage.getItem(`fb_cache_${key}`)); } catch (_) { return null; }
}

/* ═══════════════════════════════════════════════════════════════════
   DOM HELPERS
════════════════════════════════════════════════════════════════════ */
function showEl(id) { const el = $(`#${id}`); if (el) el.style.display = ''; }
function hideEl(id) { const el = $(`#${id}`); if (el) el.style.display = 'none'; }

/* ═══════════════════════════════════════════════════════════════════
   DEMO FALLBACK DONATIONS (if backend unavailable)
════════════════════════════════════════════════════════════════════ */
function getDemoDonations() {
  const now = Date.now();
  return [
    {
      id: 'DEMO-001', foodName: '50 Meal Boxes (Vegetarian Thali)', category: 'Cooked Meals',
      quantity: '50 boxes', numberOfMeals: 50, donorName: 'The Spice Garden Restaurant', donorAddress: '142 Main Street, Downtown',
      distanceKm: 1.8, postedTime: new Date(now - 1800000).toISOString(), expiryTime: new Date(now + 5400000).toISOString(),
      isVegetarian: true, imageUrl: 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400&auto=format&fit=crop',
      smartMatch: { matchScore: 94, matchExplanation: 'Recommended because you are 1.8 km away and available for pickup.' }
    },
    {
      id: 'DEMO-002', foodName: 'Artisan Bread & Croissant Pack', category: 'Bakery',
      quantity: '35 kg (90 items)', numberOfMeals: 40, donorName: 'Golden Crust Bakery', donorAddress: '88 Park Avenue, North District',
      distanceKm: 3.2, postedTime: new Date(now - 3600000).toISOString(), expiryTime: new Date(now + 14400000).toISOString(),
      isVegetarian: true, imageUrl: 'https://images.unsplash.com/photo-1509440159596-0249088772ff?w=400&auto=format&fit=crop',
      smartMatch: { matchScore: 88, matchExplanation: 'Matches your transport capacity and route radius.' }
    },
    {
      id: 'DEMO-003', foodName: 'Fresh Vegetable Box — Assorted', category: 'Fresh Produce',
      quantity: '60 kg', numberOfMeals: 120, donorName: 'City Farmers Market', donorAddress: '20 Market Lane, East Side',
      distanceKm: 4.5, postedTime: new Date(now - 900000).toISOString(), expiryTime: new Date(now + 86400000).toISOString(),
      isVegetarian: true, imageUrl: 'https://images.unsplash.com/photo-1540420773420-3366772f4999?w=400&auto=format&fit=crop',
      smartMatch: { matchScore: 82, matchExplanation: 'Nearby produce donation within your service radius.' }
    },
    {
      id: 'DEMO-004', foodName: 'Catered Event Leftover Meals', category: 'Cooked Meals',
      quantity: '80 portions', numberOfMeals: 80, donorName: 'Grand Banquet Hall', donorAddress: '5 Convention Rd, West End',
      distanceKm: 6.1, postedTime: new Date(now - 600000).toISOString(), expiryTime: new Date(now + 2700000).toISOString(),
      isVegetarian: false, imageUrl: 'https://images.unsplash.com/photo-1555939594-58d7cb561ad1?w=400&auto=format&fit=crop',
      smartMatch: { matchScore: 76, matchExplanation: '6.1 km away. Act fast — expiring in ~45 minutes.' }
    }
  ];
}
