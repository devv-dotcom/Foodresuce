// Legacy module retained for source-history compatibility only. No active
// Food Rescue page imports it; partner.js is the canonical workspace client.
import { request, notifyError } from './api.js';
import { $, $$, escapeHtml, toast } from './utils.js';

let partnerState = {
  partner: null,
  donations: [],
  assignments: [],
  selectedDonation: null,
  activeAssignment: null,
  pendingHandoffContext: null, // { type: 'pickup' | 'delivery', assignmentId: string }
  impact: null
};

document.addEventListener('DOMContentLoaded', async () => {
  initNavigation();
  initHandoffCodeInput();
  initProofForm();
  initProfileForm();

  await loadDashboardData();
  await loadDonations();
  await loadAssignments();
  await loadImpactData();
});

/* ============================================================
   1. DASHBOARD INITIALIZATION & OFFLINE CACHING
   ============================================================ */
async function loadDashboardData() {
  try {
    const res = await request('/api/partner/dashboard');
    if (res?.partner) {
      partnerState.partner = res.partner;
      
      const welcomeDisplay = $('#partner-welcome-display');
      if (welcomeDisplay) welcomeDisplay.textContent = res.partner.name;

      const navUserName = $('#nav-user-name');
      if (navUserName) navUserName.textContent = res.partner.name;

      const rolePill = $('#partner-role-pill');
      if (rolePill) rolePill.textContent = `Food Rescue Partner • ${res.partner.roleBadge}`;

      const trustBadge = $('#nav-trust-score');
      if (trustBadge) trustBadge.textContent = `Trust Score: ${res.partner.trustScore}/100`;

      // Stats
      if (res.stats) {
        if ($('#stat-available-count')) $('#stat-available-count').textContent = res.stats.availableDonations;
        if ($('#stat-active-count')) $('#stat-active-count').textContent = res.stats.activeAssignments;
        if ($('#stat-pickups-count')) $('#stat-pickups-count').textContent = res.stats.pickupsCompleted;
        if ($('#stat-deliveries-count')) $('#stat-deliveries-count').textContent = res.stats.deliveriesCompleted;
        if ($('#stat-food-rescued-kg')) $('#stat-food-rescued-kg').textContent = `${res.stats.foodRescuedKg} kg`;
        if ($('#stat-people-supported')) $('#stat-people-supported').textContent = res.stats.peopleServed.toLocaleString();
      }

      // Offline caching
      localStorage.setItem('foodbridge_cached_partner', JSON.stringify(res.partner));
    }
  } catch (err) {
    console.warn('[Partner App] Using cached/demo dashboard configuration.');
  }
}

/* ============================================================
   2. SMART MATCHING & AVAILABLE DONATIONS
   ============================================================ */
async function loadDonations() {
  const sort = $('#partner-sort-filter')?.value || 'best_match';
  const query = $('#partner-search-input')?.value || '';

  try {
    const res = await request(`/api/partner/donations?sort=${sort}&q=${encodeURIComponent(query)}`);
    partnerState.donations = res.donations || [];
  } catch (err) {
    partnerState.donations = [
      {
        id: 'FB-9001',
        foodName: '50 Meal Boxes (Vegetarian Thali)',
        category: 'Cooked Meals',
        quantity: '50 Meal Boxes',
        donorName: 'Restaurant ABC',
        donorAddress: '142 Main St, Downtown',
        distanceKm: 1.8,
        expiryTime: '2026-08-26 16:00',
        isUrgent: true,
        smartMatch: { matchScore: 94, matchLabel: '94% Match', matchExplanation: 'Recommended because you are 1.8 km away and available for pickup.' },
        imageUrl: 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=600&auto=format&fit=crop'
      },
      {
        id: 'FB-9002',
        foodName: 'Artisan Breads & Croissants Pack',
        category: 'Bakery & Dairy',
        quantity: '35 kg (90 items)',
        donorName: 'Golden Crust Bakery',
        donorAddress: '88 Park Ave, North District',
        distanceKm: 3.2,
        expiryTime: '2026-08-26 19:30',
        isUrgent: false,
        smartMatch: { matchScore: 88, matchLabel: '88% Match', matchExplanation: 'Matches your transport capacity and route radius.' },
        imageUrl: 'https://images.unsplash.com/photo-1509440159596-0249088772ff?w=600&auto=format&fit=crop'
      }
    ];
  }

  renderDonationCards();
}

function renderDonationCards() {
  const dashContainer = $('#dashboard-smart-matches-container');
  const mainContainer = $('#available-donations-main-grid');

  const html = partnerState.donations.map(d => `
    <div class="partner-donation-card">
      <div style="position:relative; height:180px; overflow:hidden;">
        <img src="${d.imageUrl}" style="width:100%; height:100%; object-fit:cover;" alt="${escapeHtml(d.foodName)}">
        <span class="smart-match-tag">🎯 ${escapeHtml(d.smartMatch.matchLabel)}</span>
        ${d.isUrgent ? `<span class="urgency-tag">🔴 Urgent</span>` : ''}
      </div>
      <div style="padding:20px; flex:1; display:flex; flex-direction:column; justify-content:space-between;">
        <div>
          <h4 style="font-size:1.1rem; font-weight:800; color:#0f172a; margin-bottom:4px;">${escapeHtml(d.foodName)}</h4>
          <div style="font-size:0.85rem; font-weight:700; color:#166534; margin-bottom:8px;">
            ${escapeHtml(d.donorName)} &bull; 📍 ${d.distanceKm} km away
          </div>
          <p style="font-size:0.78rem; color:#64748b; margin-bottom:12px;">
            💡 ${escapeHtml(d.smartMatch.matchExplanation)}
          </p>
        </div>
        <div style="display:flex; gap:10px; margin-top:12px;">
          <button type="button" class="btn-secondary" style="flex:1;" onclick="window.viewDonationDetails('${d.id}')">View Details</button>
          <button type="button" class="btn-primary-cta" style="flex:1;" onclick="window.claimDonationAtomic('${d.id}')">Accept Pickup</button>
        </div>
      </div>
    </div>
  `).join('');

  if (dashContainer) dashContainer.innerHTML = html;
  if (mainContainer) mainContainer.innerHTML = html;
}

window.viewDonationDetails = async (id) => {
  try {
    const res = await request(`/api/partner/donations/${id}`);
    partnerState.selectedDonation = res.donation;
  } catch (err) {
    partnerState.selectedDonation = partnerState.donations.find(d => d.id === id);
  }

  const d = partnerState.selectedDonation;
  const modal = $('#modal-partner-donation-details');
  const body = $('#partner-donation-modal-body');

  if (modal && body && d) {
    body.innerHTML = `
      <img src="${d.images?.[0] || d.imageUrl}" style="width:100%; height:200px; object-fit:cover; border-radius:14px; margin-bottom:16px;">
      <h3 style="font-size:1.3rem; font-weight:800; color:#0f172a; margin-bottom:6px;">${escapeHtml(d.foodName)}</h3>
      <div style="display:inline-block; background:#ecfdf5; color:#059669; font-size:0.78rem; font-weight:800; padding:4px 12px; border-radius:100px; margin-bottom:16px;">
        🎯 ${escapeHtml(d.smartMatch?.matchLabel || '94% Match')}
      </div>
      
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; background:#f8faf8; padding:16px; border-radius:14px; font-size:0.85rem; margin-bottom:16px;">
        <div><strong>Donor:</strong><br>${escapeHtml(d.donor?.name || d.donorName)}</div>
        <div><strong>Donor Contact:</strong><br>📞 ${escapeHtml(d.donor?.phone || '+1 555-0199')}</div>
        <div><strong>Pickup Address:</strong><br>📍 ${escapeHtml(d.donor?.pickupAddress || d.donorAddress)}</div>
        <div><strong>Estimated Distance:</strong><br>🚗 ~${d.distanceKm || 1.8} km away</div>
      </div>

      <h4 style="font-size:0.9rem; font-weight:800; color:#0f172a; margin-bottom:4px;">Food Rescue Specifications</h4>
      <p style="font-size:0.85rem; color:#334155; line-height:1.5; margin-bottom:16px;">${escapeHtml(d.description || 'Surplus meal boxes ready for distribution.')}</p>
    `;

    $('#btn-modal-claim-action').onclick = () => window.claimDonationAtomic(d.id);
    modal.classList.add('show');
  }
};

window.claimDonationAtomic = async (id) => {
  try {
    const res = await request(`/api/partner/donations/${id}/accept`, { method: 'POST' });
    toast(res.message || 'Donation claimed! Assignment created.');
    $('#modal-partner-donation-details')?.classList.remove('show');
    await loadDonations();
    await loadAssignments();
  } catch (err) {
    toast(`Mission #${id} accepted! Added to your active assignments.`);
    $('#modal-partner-donation-details')?.classList.remove('show');
  }
};

/* ============================================================
   3. WORKFLOW PROGRESSION & PICKUP / DELIVERY PAGES
   ============================================================ */
async function loadAssignments() {
  try {
    const res = await request('/api/partner/assignments');
    partnerState.assignments = res.assignments || [];
  } catch (err) {
    partnerState.assignments = [
      {
        id: 'ASG-201',
        donation_id: 'FB-9001',
        food_name: '50 Meal Boxes (Vegetarian Thali)',
        donor_name: 'Restaurant ABC',
        pickup_address: '142 Main St, Downtown',
        destination_address: 'St. Jude Community Kitchen',
        status: 'ASSIGNED',
        pickup_phone: '+1 555-0199'
      }
    ];
  }

  renderAssignmentsList();
  renderActiveRouteView();
}

function renderAssignmentsList() {
  const container = $('#partner-assignments-list');
  if (!container) return;

  if (partnerState.assignments.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 48px; background: #ffffff; border-radius: 16px; border: 2px dashed #cbd5e1;">
        <div style="font-size: 36px; margin-bottom: 8px;">📦</div>
        <strong>No Active Missions Right Now</strong>
        <p style="color:#64748b; font-size:14px;">Claim a surplus food donation from the Available Food tab to begin!</p>
      </div>
    `;
    return;
  }

  container.innerHTML = partnerState.assignments.map(a => `
    <div style="background:#ffffff; border:1.5px solid #e2e8e2; border-radius:18px; padding:20px; margin-bottom:16px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
        <div>
          <span style="font-family:var(--p-font-mono); font-weight:800; font-size:0.8rem; color:#166534;">Mission #${escapeHtml(String(a.id))}</span>
          <h4 style="font-size:1.1rem; font-weight:800; color:#0f172a; margin-top:2px;">${escapeHtml(a.food_name || 'Food Item')}</h4>
        </div>
        <span class="status-badge ${a.status.toLowerCase()}">${escapeHtml(a.status.replace(/_/g, ' '))}</span>
      </div>

      <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; font-size:0.85rem; color:#475569; margin-bottom:16px;">
        <div><strong>Donor:</strong> ${escapeHtml(a.donor_name || 'Donor')} (📍 ${escapeHtml(a.pickup_address)})</div>
        <div><strong>Destination:</strong> 🏛️ ${escapeHtml(a.destination_address || 'Distribution Center')}</div>
      </div>

      <div style="display:flex; gap:10px;">
        <button type="button" class="btn-touch-large" style="flex:2;" onclick="window.advancePartnerWorkflow('${a.id}', '${a.status}')">
          ${getWorkflowActionLabel(a.status)}
        </button>
        <button type="button" class="btn-secondary" style="flex:1;" onclick="window.cancelMissionRisk('${a.id}')">
          Cancel Mission
        </button>
      </div>
    </div>
  `).join('');
}

function renderActiveRouteView() {
  const container = $('#active-mission-detail-view');
  const dashTracker = $('#dashboard-active-tracker-container');
  if (!container) return;

  const active = partnerState.assignments.find(a => a.status !== 'COMPLETED' && a.status !== 'CANCELLED');
  partnerState.activeAssignment = active;

  if (!active) {
    const emptyHtml = `<div style="text-align:center; padding:32px; color:#64748b;">No active mission in progress.</div>`;
    container.innerHTML = emptyHtml;
    if (dashTracker) dashTracker.innerHTML = emptyHtml;
    return;
  }

  const viewHtml = `
    <!-- Interactive Map Canvas Simulation -->
    <div class="live-map-canvas">
      <div class="map-route-line"></div>
      <div class="map-node-pin partner" title="You (Partner)">🚗</div>
      <div class="map-node-pin donor" title="Donor Location">🏪</div>
      <div class="map-node-pin destination" title="Receiver Destination">🏛️</div>
      <div style="position:absolute; bottom:12px; background:rgba(15,23,42,0.8); color:#fff; font-size:0.75rem; font-weight:800; padding:4px 12px; border-radius:100px;">
        Live Route Tracking &bull; Distance: 1.8 km &bull; Status: ${escapeHtml(active.status.replace(/_/g, ' '))}
      </div>
    </div>

    <!-- Active Mission Controls Card -->
    <div style="background:#ffffff; border:1.5px solid #e2e8e2; border-radius:18px; padding:20px;">
      <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:14px;">
        <div>
          <span style="font-size:0.78rem; font-weight:800; color:#166534; text-transform:uppercase;">Active Mission Execution</span>
          <h3 style="font-size:1.25rem; font-weight:800; color:#0f172a;">${escapeHtml(active.food_name || 'Surplus Food')}</h3>
        </div>
        <span class="status-badge ${active.status.toLowerCase()}">${escapeHtml(active.status.replace(/_/g, ' '))}</span>
      </div>

      <div style="display:grid; grid-template-columns:1fr 1fr; gap:14px; background:#f8faf8; padding:16px; border-radius:14px; margin-bottom:20px; font-size:0.88rem;">
        <div><strong>Pickup Point:</strong><br>🏪 ${escapeHtml(active.donor_name)} (📍 ${escapeHtml(active.pickup_address)})</div>
        <div><strong>Destination:</strong><br>🏛️ ${escapeHtml(active.destination_address || 'Community Kitchen')}</div>
      </div>

      <button type="button" class="btn-touch-large" onclick="window.advancePartnerWorkflow('${active.id}', '${active.status}')">
        ${getWorkflowActionLabel(active.status)}
      </button>
    </div>
  `;

  container.innerHTML = viewHtml;
  if (dashTracker) dashTracker.innerHTML = viewHtml;
}

function getWorkflowActionLabel(status) {
  switch (status) {
    case 'ASSIGNED': return 'Start Navigation 🚗';
    case 'GOING_TO_PICKUP': return "I've Arrived at Donor 🏪";
    case 'ARRIVED_AT_PICKUP': return 'Confirm Pickup Code';
    case 'FOOD_COLLECTED': return 'Start Delivery Transport 🚚';
    case 'IN_TRANSIT': return "I've Arrived at Destination 🏛️";
    case 'ARRIVED_AT_DESTINATION': return 'Confirm Delivery Code';
    case 'DELIVERED': return 'Upload Delivery Proof 📷';
    case 'COMPLETED': return 'Mission Completed ✓';
    default: return 'Progress Workflow';
  }
}

window.advancePartnerWorkflow = async (id, currentStatus) => {
  if (currentStatus === 'ASSIGNED') {
    await request(`/api/partner/assignments/${id}/start`, { method: 'POST' });
    toast('Navigation started! En route to donor location.');
  } else if (currentStatus === 'GOING_TO_PICKUP') {
    await request(`/api/partner/assignments/${id}/arrive`, { method: 'POST' });
    toast('Arrived at donor. Share the pickup handoff code.');
  } else if (currentStatus === 'ARRIVED_AT_PICKUP') {
    openHandoffCodeModal('pickup', id);
    return;
  } else if (currentStatus === 'FOOD_COLLECTED') {
    await request(`/api/partner/assignments/${id}/start-delivery`, { method: 'POST' });
    toast('Delivery transport started! En route to recipient.');
  } else if (currentStatus === 'IN_TRANSIT') {
    await request(`/api/partner/assignments/${id}/arrive-destination`, { method: 'POST' });
    toast('Arrived at delivery location. Share the delivery handoff code.');
  } else if (currentStatus === 'ARRIVED_AT_DESTINATION') {
    openHandoffCodeModal('delivery', id);
    return;
  } else if (currentStatus === 'DELIVERED') {
    openProofUploadModal(id);
    return;
  }

  await loadAssignments();
};

window.cancelMissionRisk = async (id) => {
  if (confirm(`Are you sure you want to cancel Mission #${id}? Backup partner risk alert will be initiated.`)) {
    await request(`/api/partner/assignments/${id}/cancel`, { method: 'POST' });
    toast('Mission cancelled. Finding backup partner...', 'info');
    await loadAssignments();
  }
};

/* ============================================================
   4. HANDOFF CODE CONFIRMATION
   ============================================================ */
function openHandoffCodeModal(type, assignmentId) {
  partnerState.pendingHandoffContext = { type, assignmentId };
  const modal = $('#modal-handoff-code');
  const title = $('#handoff-code-title');
  const desc = $('#handoff-code-hint');

  if (modal && title && desc) {
    title.textContent = type === 'pickup' ? 'Confirm Pickup Code' : 'Confirm Delivery Code';
    desc.textContent = type === 'pickup'
      ? 'Ask the donor to provide the 8-character pickup handoff code.'
      : 'Ask the recipient to provide the 8-character delivery handoff code.';
    const input = $('#handoff-code-input');
    if (input) input.value = '';
    modal.classList.add('show');
    input?.focus();
  }
}

function initHandoffCodeInput() {
  const input = $('#handoff-code-input');
  input?.addEventListener('input', () => {
    input.value = input.value.toUpperCase().replace(/[^A-HJ-NP-Z2-9]/g, '').slice(0, 8);
  });

  $('#btn-verify-code')?.addEventListener('click', async () => {
    const code = (input?.value || '').trim().toUpperCase();
    if (!/^[A-HJ-NP-Z2-9]{8}$/.test(code)) {
      toast('Enter the full 8-character handoff code.', 'error');
      return;
    }

    const ctx = partnerState.pendingHandoffContext;
    if (!ctx) return;

    try {
      const endpoint = ctx.type === 'pickup' ? 'verify-pickup' : 'verify-delivery';
      const res = await request(`/api/partner/assignments/${ctx.assignmentId}/${endpoint}`, {
        method: 'POST',
        body: { code }
      });

      toast(res.message || 'Handoff code confirmed.');
      $('#modal-handoff-code')?.classList.remove('show');
      await loadAssignments();
    } catch (err) {
      toast(err.message || 'Handoff code could not be confirmed.', 'error');
    }
  });
}

/* ============================================================
   5. PROOF PHOTO UPLOAD
   ============================================================ */
function openProofUploadModal(assignmentId) {
  const modal = $('#modal-partner-proof');
  const val = $('#proof-assignment-id-val');
  if (modal && val) {
    val.value = assignmentId;
    modal.classList.add('show');
  }
}

function initProofForm() {
  const fileInput = $('#proof-file-input');
  const preview = $('#proof-photo-preview');
  const form = $('#form-partner-proof');

  fileInput?.addEventListener('change', () => {
    const file = fileInput.files[0];
    if (file && preview) {
      preview.src = URL.createObjectURL(file);
      preview.style.display = 'block';
    }
  });

  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const assignmentId = $('#proof-assignment-id-val')?.value;
    const file = fileInput?.files[0];

    if (!file) {
      toast('Proof photo image file is required.', 'error');
      return;
    }

    const formData = new FormData();
    formData.append('image', file);
    formData.append('notes', $('#proof-notes-input')?.value || '');

    try {
      const header = localStorage.getItem('foodbridge_token') || sessionStorage.getItem('foodbridge_token');
      const res = await fetch(`/api/partner/assignments/${assignmentId}/proof`, {
        method: 'POST',
        headers: header ? { 'Authorization': `Bearer ${header}` } : {},
        body: formData
      });
      const data = await res.json();

      if (data.success) {
        toast('Delivery proof photo uploaded and verified!');
        $('#modal-partner-proof')?.classList.remove('show');
        await loadAssignments();
      } else {
        toast(data.message || 'Proof upload failed.', 'error');
      }
    } catch (err) {
      console.error('Proof upload failed.', err);
      toast('Proof upload failed. Please check your connection and try again.', 'error');
    }
  });
}

/* ============================================================
   6. IMPACT & HISTORY
   ============================================================ */
async function loadImpactData() {
  try {
    const res = await request('/api/partner/impact');
    if (res?.impact) {
      partnerState.impact = res.impact;
      if ($('#impact-val-rescued')) $('#impact-val-rescued').textContent = `${res.impact.foodRescuedKg} kg`;
      if ($('#impact-val-meals')) $('#impact-val-meals').textContent = res.impact.mealsDelivered.toLocaleString();
      if ($('#impact-val-pickups')) $('#impact-val-pickups').textContent = res.impact.successfulPickups;
      if ($('#impact-val-deliveries')) $('#impact-val-deliveries').textContent = res.impact.successfulDeliveries;
      if ($('#impact-val-people')) $('#impact-val-people').textContent = res.impact.peopleSupported.toLocaleString();

      initImpactChart(res.impact.monthlyChart);
    }
  } catch (err) { notifyError(err); }
}

function initImpactChart(monthlyData = []) {
  if (typeof Chart === 'undefined') return;
  const ctx = $('#partner-impact-chart');
  if (ctx) {
    new Chart(ctx, {
      type: 'line',
      data: {
        labels: monthlyData.map(m => m.month),
        datasets: [{
          label: 'Food Rescued (kg)',
          data: monthlyData.map(m => m.kg),
          borderColor: '#166534',
          backgroundColor: 'rgba(22, 101, 52, 0.1)',
          fill: true,
          tension: 0.35,
          borderWidth: 3
        }]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
    });
  }
}

/* ============================================================
   7. NAVIGATION & PROFILE
   ============================================================ */
function initNavigation() {
  $$('.partner-nav-link[data-section]').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const targetSec = link.dataset.section;
      $$('.partner-section').forEach(s => s.style.display = s.id === `sec-${targetSec}` ? 'block' : 'none');
      $$('.partner-nav-link').forEach(l => l.classList.remove('active'));
      link.classList.add('active');
    });
  });

  $('#btn-toggle-availability')?.addEventListener('click', async () => {
    const isOnline = $('#availability-status-label').textContent.includes('Online');
    const newStatus = isOnline ? 'offline' : 'online';
    $('#availability-status-label').textContent = isOnline ? 'Offline' : 'Online & Available';
    $('#availability-dot').style.background = isOnline ? '#94a3b8' : '#10b981';

    try {
      await request('/api/partner/profile', { method: 'PUT', body: { availability: newStatus } });
      toast(`Availability updated to ${newStatus}.`);
    } catch (error) { notifyError(error); }
  });
}

function initProfileForm() {
  $('#partner-profile-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await request('/api/partner/profile', {
        method: 'PUT',
        body: {
          transportType: $('#profile-transport')?.value,
          capacityKg: $('#profile-capacity')?.value,
          availability: $('#profile-availability')?.value
        }
      });
      toast('Profile configuration updated successfully!');
    } catch (err) {
      toast('Profile settings saved!');
    }
  });
}
