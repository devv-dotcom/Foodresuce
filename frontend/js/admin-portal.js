import { request, notifyError } from './api.js';
import { $, $$, escapeHtml, toast } from './utils.js';

// Comprehensive mock dataset for food rescue platform operations
let state = {
  donations: [
    { id: 'FB-9401', donor: 'Green Bay Bakery', foodName: 'Artisan Bread & Muffins', category: 'Bakery', quantity: '45 kg (120 meals)', location: 'Downtown', postedDate: '2026-08-26 08:30', freshness: 90, expiryText: '3 hours left', assignedNgo: 'Hope Haven Shelter', status: 'assigned' },
    { id: 'FB-9402', donor: 'Metro Supermarket', foodName: 'Organic Fruits & Greens', category: 'Fresh Produce', quantity: '80 kg (200 meals)', location: 'North District', postedDate: '2026-08-26 09:15', freshness: 75, expiryText: '5 hours left', assignedNgo: 'Unassigned', status: 'available' },
    { id: 'FB-9403', donor: 'Sunrise Catering', foodName: 'Steamed Rice & Veg Curry', category: 'Cooked Meals', quantity: '60 kg (150 meals)', location: 'West Suburbs', postedDate: '2026-08-26 07:45', freshness: 60, expiryText: '2 hours left', assignedNgo: 'Community Kitchen NGO', status: 'accepted' },
    { id: 'FB-9404', donor: 'Fresh Farm Hub', foodName: 'Whole Milk & Cheese Pack', category: 'Bakery', quantity: '35 kg (90 meals)', location: 'East Side', postedDate: '2026-08-26 06:10', freshness: 100, expiryText: '12 hours left', assignedNgo: 'St. Jude Food Pantry', status: 'picked_up' },
    { id: 'FB-9405', donor: 'Grand Plaza Hotel', foodName: 'Surplus Buffet Dinner', category: 'Cooked Meals', quantity: '110 kg (280 meals)', location: 'Downtown', postedDate: '2026-08-25 21:00', freshness: 95, expiryText: 'Delivered', assignedNgo: 'City Harvest Shelter', status: 'delivered' },
    { id: 'FB-9406', donor: 'Corner Delicatessen', foodName: 'Sandwiches & Salads', category: 'Cooked Meals', quantity: '25 kg (60 meals)', location: 'North District', postedDate: '2026-08-25 18:00', freshness: 0, expiryText: 'Expired', assignedNgo: 'None', status: 'expired' },
    { id: 'FB-9407', donor: 'Bistro 44', foodName: 'Roasted Vegetables', category: 'Cooked Meals', quantity: '30 kg (75 meals)', location: 'West Suburbs', postedDate: '2026-08-25 19:30', freshness: 0, expiryText: 'Cancelled by Donor', assignedNgo: 'None', status: 'cancelled' }
  ],
  pendingNgos: [
    { id: 'ngo-pending-1', name: 'St. Jude Community Kitchen', contactPerson: 'Rev. Thomas Miller', email: 'thomas@stjude-kitchen.org', phone: '+1 555-0192', location: 'Downtown', taxId: 'TAX-8849201', regDate: '2026-08-25' },
    { id: 'ngo-pending-2', name: 'Hope Pantry Foundation', contactPerson: 'Maria Rodriguez', email: 'maria@hopepantry.org', phone: '+1 555-0381', location: 'East Side', taxId: 'TAX-4491029', regDate: '2026-08-26' },
    { id: 'ngo-pending-3', name: 'Nourish All Relief Org', contactPerson: 'David Chen', email: 'd.chen@nourishall.org', phone: '+1 555-0472', location: 'North District', taxId: 'TAX-9920148', regDate: '2026-08-26' }
  ],
  ngos: [
    { id: 'ngo-1', name: 'Hope Haven Shelter', contactPerson: 'Elena Vance', email: 'elena@hopehaven.org', phone: '+1 555-1122', location: 'Downtown', status: 'verified', claimedCount: 142, regDate: '2025-11-14' },
    { id: 'ngo-2', name: 'Community Kitchen NGO', contactPerson: 'James Peterson', email: 'jp@communitykitchen.org', phone: '+1 555-3344', location: 'West Suburbs', status: 'verified', claimedCount: 310, regDate: '2025-06-20' },
    { id: 'ngo-3', name: 'City Harvest Shelter', contactPerson: 'Aisha Omar', email: 'aisha@cityharvest.org', phone: '+1 555-5566', location: 'Downtown', status: 'verified', claimedCount: 520, regDate: '2024-03-10' },
    { id: 'ngo-4', name: 'Valley Outreach', contactPerson: 'Robert Kim', email: 'robert@valleyoutreach.org', phone: '+1 555-7788', location: 'North District', status: 'suspended', claimedCount: 45, regDate: '2026-01-05' }
  ],
  donors: [
    { id: 'dnr-1', name: 'Green Bay Bakery', category: 'bakery', email: 'contact@greenbaybakery.com', phone: '+1 555-9011', location: 'Downtown', totalDonations: 84, status: 'active', regDate: '2025-08-12' },
    { id: 'dnr-2', name: 'Metro Supermarket', category: 'supermarket', email: 'donations@metrosuper.com', phone: '+1 555-9022', location: 'North District', totalDonations: 215, status: 'active', regDate: '2025-04-01' },
    { id: 'dnr-3', name: 'Grand Plaza Hotel', category: 'catering', email: 'events@grandplaza.com', phone: '+1 555-9033', location: 'Downtown', totalDonations: 160, status: 'active', regDate: '2025-01-15' },
    { id: 'dnr-4', name: 'Bistro 44', category: 'restaurant', email: 'manager@bistro44.com', phone: '+1 555-9044', location: 'West Suburbs', totalDonations: 38, status: 'active', regDate: '2026-02-10' }
  ],
  volunteers: [
    { id: 'vol-1', name: 'Alex Rivera', role: 'driver', phone: '+1 555-4011', city: 'Downtown', completedPickups: 148, rating: '4.9 ⭐', status: 'active', vehicle: 'Van' },
    { id: 'vol-2', name: 'Marco Santos', role: 'driver', phone: '+1 555-4022', city: 'North District', completedPickups: 92, rating: '4.8 ⭐', status: 'active', vehicle: 'Car' },
    { id: 'vol-3', name: 'Priya Sharma', role: 'inspector', phone: '+1 555-4033', city: 'West Suburbs', completedPickups: 210, rating: '5.0 ⭐', status: 'active', vehicle: 'Truck' },
    { id: 'vol-4', name: 'John Doe', role: 'dispatcher', phone: '+1 555-4044', city: 'East Side', completedPickups: 54, rating: '4.7 ⭐', status: 'inactive', vehicle: 'Scooter' }
  ],
  pickups: [
    { id: 'FB-9401', donorName: 'Green Bay Bakery', ngoName: 'Hope Haven Shelter 🚚', receiverName: 'Community Center', eta: '18 mins', step: 2, status: 'In Transit' },
    { id: 'FB-9403', donorName: 'Sunrise Catering', ngoName: 'Community Kitchen NGO 🚚', receiverName: 'Westside Shelter', eta: '35 mins', step: 1, status: 'NGO Arrived at Donor' },
    { id: 'FB-9404', donorName: 'Fresh Farm Hub', ngoName: 'City Harvest Shelter 🚚', receiverName: 'St. Jude Food Pantry', eta: 'Delivered', step: 3, status: 'Completed' }
  ],
  alerts: [
    { id: 'alt-1', priority: 'critical', title: 'Food Donation Expiring Soon', body: 'Donation #FB-9403 (60 kg Curry) has 2 hours left before expiration.', time: '10 mins ago' },
    { id: 'alt-2', priority: 'high', title: 'Pickup Delay Reported', body: 'Partner NGO vehicle delayed in traffic for Pickup #FB-9404.', time: '25 mins ago' },
    { id: 'alt-3', priority: 'medium', title: 'Pending NGO Verifications', body: '3 new NGO verification requests waiting for review.', time: '1 hour ago' },
    { id: 'alt-4', priority: 'low', title: 'Monthly Report Ready', body: 'August 2026 Social Impact Report generated successfully.', time: '4 hours ago' }
  ],
  activityLogs: [
    { actor: 'Sarah Jenkins (Admin)', action: 'Approved NGO verification for "Hope Haven Shelter"', time: '12 mins ago' },
    { actor: 'Hope Haven NGO (Partner)', action: 'Assigned to Delivery #FB-9401 (Green Bay Bakery)', time: '45 mins ago' },
    { actor: 'System Automation', action: 'Flagged 1 expiring food donation (#FB-9403)', time: '1 hour ago' },
    { actor: 'Sarah Jenkins (Admin)', action: 'Logged in from IP 192.168.1.45 (2FA Verified)', time: '3 hours ago' }
  ]
};

// Fixture data above is retained only for an explicitly enabled local visual
// demo.  Production always begins empty and is populated from protected APIs.
const ADMIN_DEMO_MODE = window.FOODBRIDGE_ENABLE_ADMIN_DEMO === true;
if (!ADMIN_DEMO_MODE) {
  state = { donations: [], pendingNgos: [], ngos: [], donors: [], volunteers: [], pickups: [], alerts: [], activityLogs: [] };
}

// Initialize Admin Dashboard Interactivity
document.addEventListener('DOMContentLoaded', () => {
  initTabNavigation();
  initSearchAndFilters();
  initModalHandlers();
  initQuickActionButtons();
  initMobileSidebarToggle();

  // Render Datasets
  renderAllDonations();
  renderPendingNgos();
  renderAllNgos();
  renderDonors();
  renderVolunteers();
  renderPickupsTimeline();
  renderAlertFeed();
  renderActivityLogs();

  // Init Analytics Charts
  initAnalyticsCharts();

  // Try fetching API data if backend is available
  fetchBackendData();
});

/* ============================================================
   1. NAVIGATION & TAB SWITCHING
   ============================================================ */
function initTabNavigation() {
  const navItems = $$('.sidebar-nav .nav-item[data-tab]');
  const sections = $$('.dashboard-section');

  const switchTab = (targetTab) => {
    navItems.forEach(item => {
      if (item.dataset.tab === targetTab) item.classList.add('active');
      else item.classList.remove('active');
    });

    sections.forEach(sec => {
      if (sec.id === `sec-${targetTab}`) sec.classList.add('active');
      else sec.classList.remove('active');
    });

    const activeItem = $(`.sidebar-nav .nav-item[data-tab="${targetTab}"]`);
    if (activeItem) {
      $('#active-page-title').textContent = activeItem.innerText.trim().replace(/\n.*$/, '');
    }

    // Scroll to top of content
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  navItems.forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      switchTab(item.dataset.tab);
    });
  });

  // Check URL hash
  const hash = window.location.hash.replace('#', '');
  if (hash && $(`#sec-${hash}`)) {
    switchTab(hash);
  }
}

/* ============================================================
   2. MOBILE SIDEBAR TOGGLE
   ============================================================ */
function initMobileSidebarToggle() {
  const toggleBtn = $('#mobile-menu-toggle');
  const closeBtn = $('#sidebar-close-btn');
  const sidebar = $('#admin-sidebar');

  toggleBtn?.addEventListener('click', () => sidebar?.classList.add('open'));
  closeBtn?.addEventListener('click', () => sidebar?.classList.remove('open'));
}

/* ============================================================
   3. DONATION MANAGEMENT TABLE RENDERING & FILTERS
   ============================================================ */
function renderAllDonations() {
  const tbody = $('#donations-table-body');
  const overviewTbody = $('#overview-recent-donations-tbody');
  if (!tbody) return;

  const searchVal = $('#donation-search-input')?.value.toLowerCase() || '';
  const statusVal = $('#donation-status-filter')?.value || 'all';
  const locationVal = $('#donation-location-filter')?.value || 'all';

  const filtered = state.donations.filter(d => {
    const matchesSearch = d.id.toLowerCase().includes(searchVal) ||
                          d.donor.toLowerCase().includes(searchVal) ||
                          d.foodName.toLowerCase().includes(searchVal);
    const matchesStatus = statusVal === 'all' || d.status === statusVal;
    const matchesLocation = locationVal === 'all' || d.location === locationVal;
    return matchesSearch && matchesStatus && matchesLocation;
  });

  // Render main donations table
  tbody.innerHTML = filtered.length === 0 
    ? `<tr><td colspan="10" style="text-align:center; padding:32px; color:#64748b;">No food donations match your filters.</td></tr>`
    : filtered.map(d => {
        const freshClass = d.freshness > 70 ? 'freshness-high' : (d.freshness > 30 ? 'freshness-medium' : 'freshness-low');
        return `
          <tr>
            <td class="cell-id">${escapeHtml(d.id)}</td>
            <td>
              <div class="user-cell">
                <div class="user-mini-avatar">🏪</div>
                <div class="user-cell-info">
                  <span class="user-cell-title">${escapeHtml(d.donor)}</span>
                </div>
              </div>
            </td>
            <td>
              <strong>${escapeHtml(d.foodName)}</strong><br>
              <span style="font-size:0.75rem; color:#64748b;">${escapeHtml(d.category)}</span>
            </td>
            <td><strong>${escapeHtml(d.quantity)}</strong></td>
            <td>📍 ${escapeHtml(d.location)}</td>
            <td style="font-size:0.8rem;">${escapeHtml(d.postedDate)}</td>
            <td>
              <div class="freshness-bar-wrap">
                <div class="freshness-bar-bg">
                  <div class="freshness-bar-fill ${freshClass}" style="width: ${d.freshness}%;"></div>
                </div>
                <span class="freshness-text">${escapeHtml(d.expiryText)}</span>
              </div>
            </td>
            <td>${escapeHtml(d.assignedNgo)}</td>
            <td><span class="status-badge ${d.status}">${escapeHtml(d.status.replace('_', ' '))}</span></td>
            <td style="text-align: right;">
              <div class="action-buttons-group" style="justify-content: flex-end;">
                <button type="button" class="icon-action-btn" title="View Details" onclick="window.viewDonationDetails('${d.id}')">👁️</button>
                <button type="button" class="icon-action-btn danger" title="Cancel/Delete" onclick="window.deleteDonation('${d.id}')">🗑️</button>
              </div>
            </td>
          </tr>
        `;
      }).join('');

  // Also render top 4 items into Overview stream summary
  if (overviewTbody) {
    overviewTbody.innerHTML = state.donations.slice(0, 4).map(d => `
      <tr>
        <td class="cell-id">${escapeHtml(d.id)}</td>
        <td><strong>${escapeHtml(d.donor)}</strong></td>
        <td>${escapeHtml(d.foodName)}</td>
        <td>${escapeHtml(d.quantity)}</td>
        <td>${escapeHtml(d.expiryText)}</td>
        <td><span class="status-badge ${d.status}">${escapeHtml(d.status.replace('_', ' '))}</span></td>
      </tr>
    `).join('');
  }

  // Update counts
  if ($('#donation-showing-count')) $('#donation-showing-count').textContent = `1 - ${filtered.length}`;
  if ($('#donation-total-count')) $('#donation-total-count').textContent = state.donations.length;
}

window.viewDonationDetails = (id) => {
  const donation = state.donations.find(d => d.id === id);
  if (donation) {
    toast(`Viewing Details for ${donation.id}: ${donation.foodName} from ${donation.donor}`);
  }
};

window.deleteDonation = async (id) => {
  if (confirm(`Are you sure you want to cancel and delete donation ${id}?`)) {
    try {
      await request(`/api/admin/donation/${encodeURIComponent(id)}`, { method: 'DELETE' });
      state.donations = state.donations.filter(d => d.id !== id);
      renderAllDonations();
      toast(`Donation ${id} successfully deleted.`, 'success');
    } catch (error) { notifyError(error); }
  }
};

/* ============================================================
   4. NGO VERIFICATION & MANAGEMENT RENDERING
   ============================================================ */
function renderPendingNgos() {
  const tbody = $('#pending-ngo-table-body');
  const countBadge = $('#pending-ngo-count');
  const sidebarBadge = $('#sidebar-pending-ngo-badge');
  const banner = $('#pending-ngo-banner');

  if (countBadge) countBadge.textContent = state.pendingNgos.length;
  if (sidebarBadge) sidebarBadge.textContent = state.pendingNgos.length;
  if (banner) banner.style.display = state.pendingNgos.length > 0 ? 'flex' : 'none';

  if (!tbody) return;

  if (state.pendingNgos.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:20px; color:#15803d; font-weight:700;">✓ All NGO verification requests have been processed!</td></tr>`;
    return;
  }

  tbody.innerHTML = state.pendingNgos.map(ngo => `
    <tr>
      <td><strong>${escapeHtml(ngo.name)}</strong></td>
      <td>
        <strong>${escapeHtml(ngo.contactPerson)}</strong><br>
        <span style="font-size:0.75rem; color:#64748b;">${escapeHtml(ngo.email)} &bull; ${escapeHtml(ngo.phone)}</span>
      </td>
      <td>📍 ${escapeHtml(ngo.location)}</td>
      <td><code>${escapeHtml(ngo.taxId)}</code></td>
      <td>${escapeHtml(ngo.regDate)}</td>
      <td>
        <div class="action-buttons-group">
          <button type="button" class="btn-primary-cta" style="height:32px; padding:0 12px; font-size:0.78rem;" onclick="window.approveNgo('${ngo.id}')">✓ Verify</button>
          <button type="button" class="btn-secondary" style="height:32px; padding:0 12px; font-size:0.78rem;" onclick="window.viewNgoProfileModal('${ngo.id}', true)">Inspect</button>
        </div>
      </td>
    </tr>
  `).join('');
}

function renderAllNgos() {
  const tbody = $('#all-ngo-table-body');
  if (!tbody) return;

  const searchVal = $('#ngo-search-input')?.value.toLowerCase() || '';
  const statusVal = $('#ngo-status-filter')?.value || 'all';

  const filtered = state.ngos.filter(n => {
    const matchesSearch = n.name.toLowerCase().includes(searchVal) ||
                          n.contactPerson.toLowerCase().includes(searchVal) ||
                          n.location.toLowerCase().includes(searchVal);
    const matchesStatus = statusVal === 'all' || n.status === statusVal;
    return matchesSearch && matchesStatus;
  });

  tbody.innerHTML = filtered.map(n => `
    <tr>
      <td>
        <div class="user-cell">
          <div class="user-mini-avatar">🏛️</div>
          <div class="user-cell-info">
            <span class="user-cell-title">${escapeHtml(n.name)}</span>
          </div>
        </div>
      </td>
      <td>
        <strong>${escapeHtml(n.contactPerson)}</strong><br>
        <span style="font-size:0.75rem; color:#64748b;">${escapeHtml(n.email)} &bull; ${escapeHtml(n.phone)}</span>
      </td>
      <td>📍 ${escapeHtml(n.location)}</td>
      <td><span class="status-badge ${n.status}">${escapeHtml(n.status)}</span></td>
      <td><strong>${n.claimedCount} meals</strong></td>
      <td>${escapeHtml(n.regDate)}</td>
      <td><span class="status-badge ${n.status}">${escapeHtml(n.status)}</span></td>
      <td style="text-align: right;">
        <div class="action-buttons-group" style="justify-content: flex-end;">
          <button type="button" class="icon-action-btn" title="View Profile" onclick="window.viewNgoProfileModal('${n.id}', false)">👁️</button>
          ${n.status === 'verified' 
            ? `<button type="button" class="icon-action-btn danger" title="Suspend NGO" onclick="window.toggleNgoStatus('${n.id}', 'suspended')">⛔</button>` 
            : `<button type="button" class="icon-action-btn success" title="Reactivate NGO" onclick="window.toggleNgoStatus('${n.id}', 'verified')">✓</button>`}
        </div>
      </td>
    </tr>
  `).join('');
}

window.approveNgo = async (id) => {
  const pending = state.pendingNgos.find(n => n.id === id);
  if (pending) {
    try {
      await request(`/api/admin/ngo/approve/${encodeURIComponent(id)}`, { method: 'PUT' });
      await fetchBackendData();
      toast(`NGO "${pending.name}" has been verified successfully!`, 'success');
    } catch (error) { notifyError(error); }
  }
};

window.toggleNgoStatus = async (id, newStatus) => {
  const ngo = state.ngos.find(n => n.id === id);
  if (ngo) {
    try {
      const action = newStatus === 'suspended' ? 'suspend' : 'approve';
      await request(`/api/admin/ngo/${action}/${encodeURIComponent(id)}`, { method: 'PUT' });
      await fetchBackendData();
      toast(`NGO "${ngo.name}" status updated.`, 'success');
    } catch (error) { notifyError(error); }
  }
};

window.viewNgoProfileModal = (id, isPending) => {
  const modal = $('#modal-ngo-profile');
  const body = $('#ngo-profile-modal-body');
  const footer = $('#ngo-profile-modal-footer');
  if (!modal || !body) return;

  const item = isPending 
    ? state.pendingNgos.find(n => n.id === id) 
    : state.ngos.find(n => n.id === id);

  if (!item) return;

  body.innerHTML = `
    <div style="display:flex; align-items:center; gap:16px; margin-bottom:20px;">
      <div style="width:56px; height:56px; border-radius:50%; background:#ecfdf5; color:#059669; font-size:28px; display:grid; place-items:center;">🏛️</div>
      <div>
        <h3 style="font-size:1.2rem; font-weight:800; color:#0f172a;">${escapeHtml(item.name)}</h3>
        <span class="status-badge ${item.status || 'pending'}">${escapeHtml(item.status || 'Pending Verification')}</span>
      </div>
    </div>
    <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px; background:#f8faf8; padding:16px; border-radius:12px;">
      <div><strong>Contact Person:</strong><br>${escapeHtml(item.contactPerson)}</div>
      <div><strong>Email:</strong><br>${escapeHtml(item.email)}</div>
      <div><strong>Phone:</strong><br>${escapeHtml(item.phone)}</div>
      <div><strong>Location:</strong><br>📍 ${escapeHtml(item.location)}</div>
      <div><strong>Tax / Reg ID:</strong><br><code>${escapeHtml(item.taxId || 'TAX-VALIDATED')}</code></div>
      <div><strong>Registered Date:</strong><br>${escapeHtml(item.regDate)}</div>
    </div>
  `;

  footer.innerHTML = `
    <button type="button" class="btn-secondary modal-close-btn">Close</button>
    ${isPending ? `<button type="button" class="btn-primary-cta" onclick="window.approveNgo('${item.id}'); $('#modal-ngo-profile').classList.remove('show');">Approve & Verify NGO</button>` : ''}
  `;

  modal.classList.add('show');
};

/* ============================================================
   5. DONORS & VOLUNTEERS RENDERING
   ============================================================ */
function renderDonors() {
  const tbody = $('#donors-table-body');
  if (!tbody) return;

  const searchVal = $('#donor-search-input')?.value.toLowerCase() || '';
  const typeVal = $('#donor-type-filter')?.value || 'all';

  const filtered = state.donors.filter(d => {
    const matchesSearch = d.name.toLowerCase().includes(searchVal) || d.email.toLowerCase().includes(searchVal);
    const matchesType = typeVal === 'all' || d.category === typeVal;
    return matchesSearch && matchesType;
  });

  tbody.innerHTML = filtered.map(d => `
    <tr>
      <td>
        <div class="user-cell">
          <div class="user-mini-avatar">🏪</div>
          <div class="user-cell-info">
            <span class="user-cell-title">${escapeHtml(d.name)}</span>
          </div>
        </div>
      </td>
      <td><span style="text-transform:capitalize; font-weight:700;">${escapeHtml(d.category)}</span></td>
      <td>${escapeHtml(d.email)}<br><span style="font-size:0.75rem; color:#64748b;">${escapeHtml(d.phone)}</span></td>
      <td>📍 ${escapeHtml(d.location)}</td>
      <td><strong>${d.totalDonations} listings</strong></td>
      <td><span class="status-badge verified">${escapeHtml(d.status)}</span></td>
      <td>${escapeHtml(d.regDate)}</td>
      <td style="text-align: right;">
        <button type="button" class="icon-action-btn" title="View Donor">👁️</button>
      </td>
    </tr>
  `).join('');
}

function renderVolunteers() {
  const tbody = $('#volunteers-table-body');
  if (!tbody) return;

  const searchVal = $('#volunteer-search-input')?.value.toLowerCase() || '';
  const roleVal = $('#volunteer-role-filter')?.value || 'all';

  const filtered = state.volunteers.filter(v => {
    const matchesSearch = v.name.toLowerCase().includes(searchVal) || v.city.toLowerCase().includes(searchVal);
    const matchesRole = roleVal === 'all' || v.role === roleVal;
    return matchesSearch && matchesRole;
  });

  tbody.innerHTML = filtered.map(v => `
    <tr>
      <td>
        <div class="user-cell">
          <div class="user-mini-avatar" style="background:#fefce8; color:#a16207;">🚚</div>
          <div class="user-cell-info">
            <span class="user-cell-title">${escapeHtml(v.name)}</span>
          </div>
        </div>
      </td>
      <td><strong style="text-transform:capitalize;">${escapeHtml(v.role)}</strong> (${escapeHtml(v.vehicle)})</td>
      <td>${escapeHtml(v.phone)}</td>
      <td>📍 ${escapeHtml(v.city)}</td>
      <td><strong>${v.completedPickups} pickups</strong></td>
      <td>${escapeHtml(v.rating)}</td>
      <td><span class="status-badge ${v.status === 'active' ? 'verified' : 'suspended'}">${escapeHtml(v.status)}</span></td>
      <td style="text-align: right;">
        <button type="button" class="icon-action-btn" title="Inspect">👁️</button>
      </td>
    </tr>
  `).join('');
}

/* ============================================================
   6. PICKUP & DELIVERY TIMELINE CARDS
   ============================================================ */
function renderPickupsTimeline() {
  const container = $('#pickup-timeline-cards-container');
  if (!container) return;

  container.innerHTML = state.pickups.map(p => `
    <div class="timeline-card">
      <div class="timeline-card-header">
        <span class="pickup-id-badge">Mission #${escapeHtml(p.id)}</span>
        <span class="status-badge ${p.step === 3 ? 'delivered' : 'assigned'}">${escapeHtml(p.status)}</span>
      </div>

      <div class="flow-nodes">
        <div class="flow-node completed">
          <div class="node-dot">🏪</div>
          <span class="node-label">Donor</span>
          <span class="node-sub">${escapeHtml(p.donorName)}</span>
        </div>

        <div class="flow-node ${p.step >= 2 ? 'completed' : 'active'}">
          <div class="node-dot">🚚</div>
          <span class="node-label">Partner NGO</span>
          <span class="node-sub">${escapeHtml(p.ngoName)}</span>
        </div>

        <div class="flow-node ${p.step === 3 ? 'completed' : ''}">
          <div class="node-dot">🏛️</div>
          <span class="node-label">Distribution</span>
          <span class="node-sub">${escapeHtml(p.receiverName || 'Community Table')}</span>
        </div>
      </div>

      <div class="timeline-meta-box">
        <div class="meta-item">
          <span>Partner NGO Fleet</span>
          <strong>${escapeHtml(p.ngoName)}</strong>
        </div>
        <div class="meta-item">
          <span>Estimated Time</span>
          <strong style="color:#166534;">${escapeHtml(p.eta)}</strong>
        </div>
      </div>
    </div>
  `).join('');
}

/* ============================================================
   7. ALERTS & NOTIFICATIONS FEED
   ============================================================ */
function renderAlertFeed() {
  const feed = $('#alert-feed-list');
  if (!feed) return;

  const priorityVal = $('#alert-priority-filter')?.value || 'all';

  const filtered = state.alerts.filter(a => priorityVal === 'all' || a.priority === priorityVal);

  feed.innerHTML = filtered.map(a => `
    <div class="alert-feed-item ${a.priority}">
      <div class="alert-item-icon">${a.priority === 'critical' ? '⚡' : (a.priority === 'high' ? '⚠️' : '🔔')}</div>
      <div class="alert-item-content">
        <div class="alert-item-top">
          <span class="alert-item-title">${escapeHtml(a.title)}</span>
          <span class="alert-item-time">${escapeHtml(a.time)}</span>
        </div>
        <div class="alert-item-body">${escapeHtml(a.body)}</div>
      </div>
    </div>
  `).join('');
}

/* ============================================================
   8. ADMIN ACTIVITY AUDIT LOG
   ============================================================ */
function renderActivityLogs() {
  const miniLog = $('#overview-mini-activity-log');
  const fullLog = $('#full-activity-log-container');

  const html = state.activityLogs.map(l => `
    <div class="log-item">
      <div class="log-item-header">
        <span class="log-actor">${escapeHtml(l.actor)}</span>
        <span class="log-time">${escapeHtml(l.time)}</span>
      </div>
      <div class="log-action-text">${escapeHtml(l.action)}</div>
    </div>
  `).join('');

  if (miniLog) miniLog.innerHTML = html;
  if (fullLog) fullLog.innerHTML = html;
}

function addAuditLog(actor, action) {
  state.activityLogs.unshift({ actor, action, time: 'Just now' });
  renderActivityLogs();
}

/* ============================================================
   9. SEARCH & FILTER EVENT LISTENERS
   ============================================================ */
function initSearchAndFilters() {
  $('#donation-search-input')?.addEventListener('input', renderAllDonations);
  $('#donation-status-filter')?.addEventListener('change', renderAllDonations);
  $('#donation-location-filter')?.addEventListener('change', renderAllDonations);
  
  $('#ngo-search-input')?.addEventListener('input', renderAllNgos);
  $('#ngo-status-filter')?.addEventListener('change', renderAllNgos);

  $('#donor-search-input')?.addEventListener('input', renderDonors);
  $('#donor-type-filter')?.addEventListener('change', renderDonors);

  $('#volunteer-search-input')?.addEventListener('input', renderVolunteers);
  $('#volunteer-role-filter')?.addEventListener('change', renderVolunteers);

  $('#alert-priority-filter')?.addEventListener('change', renderAlertFeed);

  // Global search dropdown
  const globalInput = $('#global-search-input');
  const dropdown = $('#search-results-dropdown');

  globalInput?.addEventListener('input', (e) => {
    const val = e.target.value.toLowerCase().trim();
    if (!val) {
      dropdown?.classList.remove('show');
      return;
    }

    const matchesDonations = state.donations.filter(d => d.foodName.toLowerCase().includes(val) || d.donor.toLowerCase().includes(val));
    const matchesNgos = state.ngos.filter(n => n.name.toLowerCase().includes(val));

    dropdown.innerHTML = `
      <div class="search-result-group-header">Donations</div>
      ${matchesDonations.length ? matchesDonations.slice(0, 3).map(d => `<div class="search-result-item" onclick="window.viewDonationDetails('${d.id}')">🍲 ${escapeHtml(d.foodName)} <span class="search-result-badge">${d.status}</span></div>`).join('') : '<div style="padding:6px 12px; font-size:0.8rem; color:#94a3b8;">No matching donations</div>'}
      <div class="search-result-group-header">NGOs</div>
      ${matchesNgos.length ? matchesNgos.slice(0, 3).map(n => `<div class="search-result-item" onclick="window.viewNgoProfileModal('${n.id}', false)">🏛️ ${escapeHtml(n.name)}</div>`).join('') : '<div style="padding:6px 12px; font-size:0.8rem; color:#94a3b8;">No matching NGOs</div>'}
    `;
    dropdown?.classList.add('show');
  });

  document.addEventListener('click', (e) => {
    if (!globalInput?.contains(e.target) && !dropdown?.contains(e.target)) {
      dropdown?.classList.remove('show');
    }
  });

  // Global '/' keyboard shortcut
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && document.activeElement !== globalInput) {
      e.preventDefault();
      globalInput?.focus();
    }
  });
}

/* ============================================================
   10. MODALS & FORMS HANDLERS
   ============================================================ */
function initModalHandlers() {
  const closeModals = () => $$('.modal-backdrop').forEach(m => m.classList.remove('show'));

  document.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal-close-btn') || e.target.classList.contains('modal-backdrop')) {
      closeModals();
    }
  });

  // Topbar "+ Add Donation" Button
  $('#btn-quick-add-donation')?.addEventListener('click', () => $('#modal-add-donation')?.classList.add('show'));
  $('#btn-add-donation-modal-trigger')?.addEventListener('click', () => $('#modal-add-donation')?.classList.add('show'));

  // Form Submission: Add Donation
  $('#form-add-donation')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const newDonation = {
      id: `FB-${Math.floor(9400 + Math.random() * 500)}`,
      donor: $('#input-donor-name').value || 'Metro Supermarket',
      foodName: $('#input-food-name').value || 'Surplus Meals',
      category: $('#input-food-category').value || 'Cooked Meals',
      quantity: $('#input-quantity').value || '50 kg',
      location: $('#input-pickup-location').value || 'Downtown',
      postedDate: new Date().toISOString().slice(0, 16).replace('T', ' '),
      freshness: 100,
      expiryText: `${$('#input-expiry-hours').value || 6} hours left`,
      assignedNgo: 'Unassigned',
      status: 'available'
    };

    state.donations.unshift(newDonation);
    renderAllDonations();
    closeModals();
    toast(`Donation ${newDonation.id} published successfully!`);
    addAuditLog('Sarah Jenkins (Admin)', `Published new donation #${newDonation.id} (${newDonation.foodName})`);
  });

  // Assign Partner NGO Modal
  $('#btn-assign-partner-modal-trigger')?.addEventListener('click', () => $('#modal-assign-partner')?.classList.add('show'));
  $('#form-assign-partner')?.addEventListener('submit', (e) => {
    e.preventDefault();
    closeModals();
    toast('Partner NGO dispatched successfully! Rescue alert sent to NGO team.');
    addAuditLog('Sarah Jenkins (Admin)', 'Dispatched Partner NGO Hope Haven Shelter to Mission #FB-9402');
  });

  // Broadcast Notification Modal
  $('#btn-broadcast-notif-trigger')?.addEventListener('click', () => $('#modal-broadcast-notif')?.classList.add('show'));
  $('#form-broadcast-notif')?.addEventListener('submit', (e) => {
    e.preventDefault();
    closeModals();
    toast('Broadcast alert sent to all selected recipients!');
    addAuditLog('Sarah Jenkins (Admin)', 'Sent system-wide push broadcast alert');
  });
}

/* ============================================================
   11. QUICK ACTIONS PANEL TRIGGERS
   ============================================================ */
function initQuickActionButtons() {
  $('#qa-add-donation')?.addEventListener('click', () => $('#modal-add-donation')?.classList.add('show'));
  $('#qa-verify-ngo')?.addEventListener('click', () => {
    $(`.sidebar-nav .nav-item[data-tab="ngos"]`)?.click();
  });
  $('#qa-manage-users')?.addEventListener('click', () => {
    $(`.sidebar-nav .nav-item[data-tab="donors"]`)?.click();
  });
  $('#qa-assign-vol')?.addEventListener('click', () => $('#modal-assign-partner')?.classList.add('show'));
  $('#qa-view-reports')?.addEventListener('click', () => {
    $(`.sidebar-nav .nav-item[data-tab="analytics"]`)?.click();
  });
  $('#qa-broadcast-notif')?.addEventListener('click', () => $('#modal-broadcast-notif')?.classList.add('show'));
  
  $('#btn-review-ngos')?.addEventListener('click', () => {
    $(`.sidebar-nav .nav-item[data-tab="ngos"]`)?.click();
  });
}

/* ============================================================
   12. CHART.JS ANALYTICS INITIALIZATION
   ============================================================ */
function initAnalyticsCharts() {
  if (typeof Chart === 'undefined') return;

  // Chart 1: Food Donations Over Time
  const ctxTime = $('#chart-donations-over-time');
  if (ctxTime) {
    new Chart(ctxTime, {
      type: 'line',
      data: {
        labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug'],
        datasets: [{
          label: 'Donations Posted',
          data: [980, 1250, 1420, 1680, 1890, 2100, 2350, 2680],
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

  // Chart 2: Food Rescued by Month (kg)
  const ctxRescued = $('#chart-rescued-by-month');
  if (ctxRescued) {
    new Chart(ctxRescued, {
      type: 'bar',
      data: {
        labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug'],
        datasets: [{
          label: 'Kilograms Rescued',
          data: [9200, 11400, 13800, 15200, 17100, 18900, 21500, 24100],
          backgroundColor: '#10b981',
          borderRadius: 8
        }]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
    });
  }

  // Chart 3: Donations by Category
  const ctxCategory = $('#chart-donations-category');
  if (ctxCategory) {
    new Chart(ctxCategory, {
      type: 'doughnut',
      data: {
        labels: ['Cooked Meals', 'Fresh Produce', 'Bakery & Dairy', 'Packaged Goods'],
        datasets: [{
          data: [45, 25, 18, 12],
          backgroundColor: ['#166534', '#10b981', '#f59e0b', '#3b82f6']
        }]
      },
      options: { responsive: true, maintainAspectRatio: false }
    });
  }

  // Chart 4: Rescue Outcomes
  const ctxOutcome = $('#chart-outcome-breakdown');
  if (ctxOutcome) {
    new Chart(ctxOutcome, {
      type: 'pie',
      data: {
        labels: ['Successfully Delivered', 'Expired', 'Cancelled'],
        datasets: [{
          data: [94, 4, 2],
          backgroundColor: ['#059669', '#ef4444', '#94a3b8']
        }]
      },
      options: { responsive: true, maintainAspectRatio: false }
    });
  }
}

/* ============================================================
   13. BACKEND API INTEGRATION (OPTIONAL REFRESH)
   ============================================================ */
async function fetchBackendData() {
  try {
    const [dashboard, donationsResponse, businessesResponse, ngosResponse, notificationsResponse, logsResponse] = await Promise.all([
      request('/api/admin/dashboard'), request('/api/admin/donations?limit=100'), request('/api/admin/businesses?limit=100'),
      request('/api/admin/ngos?limit=100'), request('/api/admin/notifications?limit=50'), request('/api/admin/activity-logs?limit=50')
    ]);
    if (dashboard?.dashboard) {
      if ($('#kpi-total-donations')) {
        $('#kpi-total-donations').textContent = dashboard.dashboard.total_donations || 0;
      }
      if ($('#kpi-food-rescued')) {
        $('#kpi-food-rescued').textContent = `${dashboard.dashboard.meals_rescued || 0} meals`;
      }
    }
    const safeDate = value => value ? new Date(value).toLocaleDateString() : '—';
    state.donations = (donationsResponse.donations || []).map(d => ({ id: String(d.id), donor: d.business_name || 'Business partner', foodName: d.food_name || 'Food donation', category: d.category_name || 'Uncategorised', quantity: d.quantity || '—', location: d.business_city || d.city || '—', postedDate: safeDate(d.created_at), freshness: 0, expiryText: d.expiry_date ? `Expires ${safeDate(d.expiry_date)}` : 'No expiry supplied', assignedNgo: d.ngo_name || 'Unassigned', status: d.status || 'available' }));
    state.donors = (businessesResponse.businesses || []).map(b => ({ id: String(b.id), name: b.business_name || b.full_name || 'Business partner', category: b.role || 'business', email: b.email || '—', phone: b.mobile || '—', location: b.city || '—', totalDonations: 0, status: b.account_status || 'pending', regDate: safeDate(b.created_at) }));
    const mappedNgos = (ngosResponse.ngos || []).map(n => ({ id: String(n.id), name: n.ngo_name || n.full_name || 'NGO', contactPerson: n.full_name || '—', email: n.email || '—', phone: n.mobile || '—', location: n.city || '—', taxId: n.registration_number || '—', status: n.account_status === 'active' ? 'verified' : (n.account_status || 'pending'), claimedCount: 0, regDate: safeDate(n.created_at) }));
    state.pendingNgos = mappedNgos.filter(n => n.status === 'pending');
    state.ngos = mappedNgos.filter(n => n.status !== 'pending');
    state.pickups = state.donations.filter(d => !['available', 'cancelled', 'completed'].includes(d.status)).map(d => ({ id: d.id, donorName: d.donor, ngoName: d.assignedNgo, receiverName: 'Distribution pending', eta: d.expiryText, step: d.status === 'delivered' ? 3 : 2, status: d.status }));
    state.alerts = (notificationsResponse.notifications || []).map(n => ({ id: String(n.id), priority: n.type === 'urgent' ? 'high' : 'low', title: n.title || 'Food Rescue alert', body: n.message || '', time: safeDate(n.created_at || n.createdAt) }));
    state.activityLogs = (logsResponse.logs || []).map(l => ({ actor: l.actor_name || l.actor || 'System', action: l.action || 'Activity recorded', time: safeDate(l.created_at) }));
    renderAllDonations(); renderPendingNgos(); renderAllNgos(); renderDonors(); renderPickupsTimeline(); renderAlertFeed(); renderActivityLogs();
  } catch (err) {
    console.error('Admin data could not be loaded.', err);
    notifyError(err);
  }
}
