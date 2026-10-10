import { request, notifyError, getSession } from './api.js';
import { $, $$, escapeHtml, toast } from './utils.js';

// Admin lists start empty and are populated only by protected API responses.
const state = { donations: [], ngos: [], donors: [], pickups: [], alerts: [], activityLogs: [] };
const accountState = { rows: [], total: 0, offset: 0, limit: 25, selected: null, action: null, timer: null };

// Initialize Admin Dashboard Interactivity
document.addEventListener('DOMContentLoaded', () => {
  if ($('#current-live-clock')) $('#current-live-clock').textContent = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  const adminUser = getSession()?.user;
  if (adminUser) {
    const name = adminUser.name || adminUser.full_name || 'Administrator';
    const nameNode = $('.admin-name');
    if (nameNode) nameNode.textContent = name;
    const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase();
    if ($('#admin-avatar-initials')) $('#admin-avatar-initials').textContent = initials || 'AD';
  }
  initTabNavigation();
  initSearchAndFilters();
  initModalHandlers();
  initQuickActionButtons();
  initMobileSidebarToggle();
  initAccountManagement();

  // Render Datasets
  renderAllDonations();
  renderAllNgos();
  renderDonors();
  renderPickupsTimeline();
  renderAlertFeed();
  renderActivityLogs();

  // Init Analytics Charts
  initAnalyticsCharts();

  // Try fetching API data if backend is available
  fetchBackendData();
});

function initAccountManagement() {
  const filters = ['#account-role-filter', '#account-status-filter', '#account-verified-filter', '#account-warned-filter', '#account-from-filter', '#account-to-filter'];
  filters.forEach(selector => $(selector)?.addEventListener('change', () => { accountState.offset = 0; loadAccounts(); }));
  $('#account-search')?.addEventListener('input', () => {
    window.clearTimeout(accountState.timer);
    accountState.timer = window.setTimeout(() => { accountState.offset = 0; loadAccounts(); }, 250);
  });
  $('#accounts-refresh')?.addEventListener('click', loadAccounts);
  $('#accounts-previous')?.addEventListener('click', () => { accountState.offset = Math.max(0, accountState.offset - accountState.limit); loadAccounts(); });
  $('#accounts-next')?.addEventListener('click', () => { if (accountState.offset + accountState.limit < accountState.total) { accountState.offset += accountState.limit; loadAccounts(); } });
  $('#accounts-table-body')?.addEventListener('click', event => {
    const button = event.target.closest('[data-account-action]');
    if (!button) return;
    const account = accountState.rows.find(row => String(row.id) === button.dataset.accountId);
    if (account) openAccount(account.id);
  });
  $('#account-detail-back')?.addEventListener('click', () => switchAdminTab('accounts'));
  $('#account-edit-button')?.addEventListener('click', openEditDialog);
  $('#account-warn-button')?.addEventListener('click', () => $('#account-warning-dialog')?.showModal());
  $('#account-status-button')?.addEventListener('click', openStatusDialog);
  $('#account-delete-button')?.addEventListener('click', openDeleteDialog);
  $('#account-edit-form')?.addEventListener('submit', saveAccount);
  $('#account-warning-form')?.addEventListener('submit', issueAccountWarning);
  $('#account-action-form')?.addEventListener('submit', submitAccountAction);
  $('#btn-mark-all-notifications-read')?.addEventListener('click', async () => {
    try { await request('/api/notifications/read-all', { method: 'POST' }); await fetchBackendData(); toast('Your notifications are marked as read.', 'success'); }
    catch (error) { notifyError(error); }
  });
  $$('[data-close-dialog]').forEach(button => button.addEventListener('click', () => button.closest('dialog')?.close()));
  loadAccounts();
}

function switchAdminTab(tab) {
  const navTab = tab === 'account-detail' ? 'accounts' : tab;
  $$('.sidebar-nav .nav-item[data-tab]').forEach(item => item.classList.toggle('active', item.dataset.tab === navTab));
  $$('.dashboard-section').forEach(section => section.classList.toggle('active', section.id === `sec-${tab}`));
  const active = $(`.sidebar-nav .nav-item[data-tab="${navTab}"]`);
  if ($('#active-page-title')) $('#active-page-title').textContent = tab === 'account-detail' ? 'Account details' : active?.innerText.trim().replace(/\n.*$/, '') || 'Admin Dashboard';
  window.location.hash = navTab;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function loadAccounts() {
  const status = $('#account-table-status');
  if (status) status.textContent = 'Loading accounts…';
  const params = new URLSearchParams({ limit: String(accountState.limit), offset: String(accountState.offset) });
  const q = $('#account-search')?.value.trim();
  const role = $('#account-role-filter')?.value;
  const accountStatus = $('#account-status-filter')?.value;
  const verified = $('#account-verified-filter')?.value;
  const warned = $('#account-warned-filter')?.value;
  const from = $('#account-from-filter')?.value;
  const to = $('#account-to-filter')?.value;
  if (q) params.set('q', q);
  if (role) params.set('role', role);
  if (accountStatus) params.set('status', accountStatus);
  if (verified) params.set('verified', verified);
  if (warned) params.set('warned', warned);
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  try {
    const result = await request(`/api/admin/accounts?${params}`);
    accountState.rows = result.accounts || [];
    accountState.total = Number(result.total || 0);
    renderAccounts(result.summary || {});
    if (status) status.textContent = accountState.total ? `${accountState.total.toLocaleString()} account${accountState.total === 1 ? '' : 's'} found` : 'No accounts match these filters.';
  } catch (error) {
    if (status) status.textContent = 'Accounts could not be loaded. Refresh to try again.';
    notifyError(error);
  }
}

function renderAccounts(summary) {
  const tbody = $('#accounts-table-body');
  if (!tbody) return;
  const formatDate = value => value ? new Date(value).toLocaleDateString() : '—';
  const displayRole = role => role === 'ngo' || role === 'admin' ? role.toUpperCase() : 'Donor';
  tbody.innerHTML = accountState.rows.map(account => `<tr>
    <td>#${escapeHtml(account.id)}</td><td><strong>${escapeHtml(account.ngo_name || account.business_name || account.full_name)}</strong><br><span class="account-muted">${escapeHtml(account.email)}</span></td>
    <td>${displayRole(account.role)}</td><td><span class="account-status-pill status-${escapeHtml(account.account_status || 'active')}">${escapeHtml(account.account_status || 'active')}</span></td>
    <td>${account.is_verified ? 'Verified' : 'Not verified'}</td><td>${formatDate(account.created_at)}</td><td>${Number(account.donation_count || 0).toLocaleString()}</td><td>${Number(account.warning_count || 0).toLocaleString()}</td>
    <td><button class="btn-secondary account-view-button" type="button" data-account-action="view" data-account-id="${escapeHtml(account.id)}">View</button></td></tr>`).join('');
  if (!accountState.rows.length) tbody.innerHTML = '<tr><td colspan="9" class="account-empty">No matching accounts.</td></tr>';
  const summaryIds = { total: 'accounts-total', active: 'accounts-active', pending: 'accounts-pending', suspended: 'accounts-suspended', warned: 'accounts-warned' };
  Object.entries(summaryIds).forEach(([key, id]) => { const node = $(`#${id}`); if (node) node.textContent = Number(summary[key] || 0).toLocaleString(); });
  const first = accountState.total ? accountState.offset + 1 : 0;
  const last = Math.min(accountState.offset + accountState.rows.length, accountState.total);
  $('#accounts-count').textContent = accountState.total ? `Showing ${first}–${last} of ${accountState.total}` : 'No accounts';
  $('#accounts-page-label').textContent = `Page ${Math.floor(accountState.offset / accountState.limit) + 1}`;
  $('#accounts-previous').disabled = accountState.offset === 0;
  $('#accounts-next').disabled = accountState.offset + accountState.limit >= accountState.total;
  const warningsBadge = $('#sidebar-warnings-count');
  if (warningsBadge) { warningsBadge.textContent = Number(summary.warned || 0).toLocaleString(); warningsBadge.style.display = Number(summary.warned || 0) ? '' : 'none'; }
}

async function openAccount(id) {
  try {
    const result = await request(`/api/admin/accounts/${encodeURIComponent(id)}`);
    accountState.selected = result.account;
    renderAccountDetails(accountState.selected);
    switchAdminTab('account-detail');
  } catch (error) { notifyError(error); }
}

function renderAccountDetails(account) {
  const displayRole = account.role === 'ngo' || account.role === 'admin' ? account.role.toUpperCase() : 'Donor';
  $('#account-detail-title').textContent = account.ngo_name || account.business_name || account.full_name;
  $('#account-detail-subtitle').textContent = `${displayRole} · Account #${account.id} · ${account.email}`;
  const fields = [['Name', account.full_name], ['Email', account.email], ['Phone', account.mobile], ['Role', displayRole], ['Status', account.account_status], ['Verified', account.is_verified ? 'Yes' : 'No'], ['Registered', account.created_at ? new Date(account.created_at).toLocaleString() : 'Unavailable'], ['Last login', account.last_login_at ? new Date(account.last_login_at).toLocaleString() : 'Unavailable'], ['Location', [account.city, account.state].filter(Boolean).join(', ') || 'Unavailable'], ['Warnings', account.warning_count], ['Last account activity', account.last_account_activity ? new Date(account.last_account_activity).toLocaleString() : 'Unavailable']];
  if (account.role === 'ngo') fields.push(['NGO', account.ngo_name], ['Registration number', account.registration_number]);
  if (account.role !== 'ngo' && account.role !== 'admin') fields.push(['Business type', account.role], ['Donations', account.donation_count]);
  $('#account-detail-profile').innerHTML = fields.map(([label, value]) => `<div class="account-detail-field"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value ?? 'Unavailable')}</strong></div>`).join('');
  $('#account-detail-donations').innerHTML = (account.donations || []).map(d => `<tr><td>${escapeHtml(d.food_name)} (#${escapeHtml(d.id)})</td><td>${escapeHtml(d.category_name || 'Unavailable')}</td><td>${escapeHtml(d.quantity || 'Unavailable')}</td><td>${escapeHtml(d.status || 'Unavailable')}</td><td>${d.created_at ? new Date(d.created_at).toLocaleDateString() : '—'}</td></tr>`).join('') || '<tr><td colspan="5" class="account-empty">No donation history.</td></tr>';
  $('#account-warning-history').innerHTML = (account.warnings || []).map(w => `<article class="account-history-item"><strong>${escapeHtml(w.category.replaceAll('_', ' '))} · ${escapeHtml(w.severity)}</strong><p>${escapeHtml(w.reason)}</p><span>${w.created_at ? new Date(w.created_at).toLocaleString() : '—'} · Issued by ${escapeHtml(w.admin_name || 'Administrator')}</span></article>`).join('') || '<p class="account-muted">No warnings recorded.</p>';
  $('#account-audit-history').innerHTML = (account.history || []).map(item => `<article class="account-history-item"><strong>${escapeHtml(item.action.replaceAll('_', ' '))}</strong><p>${escapeHtml(typeof item.details_json === 'string' ? item.details_json : JSON.stringify(item.details_json || {}))}</p><span>${item.created_at ? new Date(item.created_at).toLocaleString() : '—'}</span></article>`).join('') || '<p class="account-muted">No administrative actions recorded.</p>';
  const editable = account.role !== 'admin' && account.role !== 'volunteer' && account.account_status !== 'deleted';
  ['#account-edit-button', '#account-warn-button', '#account-delete-button'].forEach(selector => { $(selector).hidden = !editable; });
  $('#account-status-button').hidden = !['active', 'suspended'].includes(account.account_status) || (account.role === 'admin' && Number(account.id) === Number(getSession()?.user?.id));
  $('#account-status-button').textContent = account.account_status === 'suspended' ? 'Restore account' : 'Suspend account';
}

function openEditDialog() {
  const account = accountState.selected;
  if (!account) return;
  const form = $('#account-edit-form');
  const values = { fullName: account.full_name, email: account.email, mobile: account.mobile, businessName: account.business_name, ngoName: account.ngo_name, registrationNumber: account.registration_number, address: account.address, city: account.city, state: account.state, pincode: account.pincode };
  Object.entries(values).forEach(([key, value]) => { if (form.elements.namedItem(key)) form.elements.namedItem(key).value = value || ''; });
  $$('.ngo-edit-field').forEach(node => { node.hidden = account.role !== 'ngo'; });
  form.elements.namedItem('businessName').closest('label').hidden = account.role === 'ngo';
  $('#account-edit-dialog').showModal();
}

async function saveAccount(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const payload = Object.fromEntries(new FormData(form));
  Object.keys(payload).forEach(key => { if (key.endsWith('Name') || key === 'registrationNumber') payload[key] = payload[key].trim(); });
  try {
    const result = await request(`/api/admin/accounts/${accountState.selected.id}`, { method: 'PUT', body: payload });
    $('#account-edit-dialog').close();
    toast(result.message || 'Account updated.', 'success');
    await loadAccounts(); await openAccount(accountState.selected.id);
  } catch (error) { notifyError(error); }
}

async function issueAccountWarning(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const payload = Object.fromEntries(new FormData(form));
  if (!payload.relatedDonationId) delete payload.relatedDonationId;
  try {
    const result = await request(`/api/admin/accounts/${accountState.selected.id}/warnings`, { method: 'POST', body: payload });
    form.reset(); $('#account-warning-dialog').close(); toast(result.message || 'Warning issued.', 'success');
    await loadAccounts(); await openAccount(accountState.selected.id);
  } catch (error) { notifyError(error); }
}

function openStatusDialog() {
  const account = accountState.selected;
  if (!account) return;
  const restore = account.account_status === 'suspended';
  accountState.action = { type: 'status', status: restore ? 'active' : 'suspended' };
  $('#account-action-title').textContent = restore ? 'Restore account' : 'Suspend account';
  $('#account-action-description').innerHTML = `<p>${restore ? 'Restore sign-in and platform access for' : 'Suspend platform access for'} <strong>${escapeHtml(account.ngo_name || account.business_name || account.full_name)}</strong> (${escapeHtml(account.email)})?</p>`;
  $('#account-confirm-field').hidden = true;
  $('#account-deletion-reason-field').hidden = true;
  $('#account-deletion-reason-field').querySelector('select').required = false;
  $('#account-confirm-field').querySelector('input').required = false;
  $('#account-reason-field').hidden = false;
  $('#account-action-submit').textContent = restore ? 'Restore account' : 'Suspend account';
  $('#account-action-dialog').showModal();
}

function openDeleteDialog() {
  const account = accountState.selected;
  if (!account) return;
  accountState.action = { type: 'delete' };
  $('#account-action-title').textContent = 'Delete / anonymize account';
  $('#account-action-description').innerHTML = `<div class="account-delete-warning"><strong>Warning: This removes personal details and cannot be undone.</strong><p>Transaction and audit history will remain. Target: <strong>${escapeHtml(account.ngo_name || account.business_name || account.full_name)}</strong> · ${escapeHtml(account.role)} · ${escapeHtml(account.email)}</p></div>`;
  $('#account-confirm-field').hidden = false;
  $('#account-deletion-reason-field').hidden = false;
  $('#account-deletion-reason-field').querySelector('select').required = true;
  const confirmInput = $('#account-confirm-field').querySelector('input');
  confirmInput.value = '';
  confirmInput.required = true;
  confirmInput.pattern = String(account.id);
  confirmInput.title = `Enter ${account.id} exactly to confirm.`;
  $('#account-reason-field').hidden = false;
  $('#account-reason-field').querySelector('textarea').minLength = 5;
  $('#account-action-submit').textContent = 'Anonymize account';
  $('#account-action-dialog').showModal();
}

async function submitAccountAction(event) {
  event.preventDefault();
  const action = accountState.action;
  const form = event.currentTarget;
  if (!action || !accountState.selected) return;
  const payload = { reason: form.elements.namedItem('reason').value.trim() };
  const endpoint = `/api/admin/accounts/${accountState.selected.id}`;
  try {
    const result = action.type === 'delete'
      ? await request(endpoint, { method: 'DELETE', body: { ...payload, deletionReason: form.elements.namedItem('deletionReason').value, confirmIdentifier: form.elements.namedItem('confirmIdentifier').value.trim() } })
      : await request(`${endpoint}/status`, { method: 'PUT', body: { ...payload, status: action.status } });
    $('#account-action-dialog').close(); form.reset(); toast(result.message || 'Account action completed.', 'success');
    accountState.selected = null; switchAdminTab('accounts'); await loadAccounts();
  } catch (error) { notifyError(error); }
}

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
              <span class="account-muted">${escapeHtml(d.expiryText || 'Deadline unavailable')}</span>
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
        <td>${escapeHtml(d.postedDate)}</td>
        <td><span class="status-badge ${d.status}">${escapeHtml(d.status.replace('_', ' '))}</span></td>
      </tr>
    `).join('');
  }

  // Update counts
  if ($('#donation-showing-count')) $('#donation-showing-count').textContent = filtered.length ? `1 - ${filtered.length}` : '0';
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
   4. NGO & RECEIVER ACCOUNT MANAGEMENT
   ============================================================ */
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
      <td><strong>${n.claimedCount == null ? 'Unavailable' : `${Number(n.claimedCount).toLocaleString()} meals`}</strong></td>
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

  const item = state.ngos.find(n => n.id === id);

  if (!item) return;

  body.innerHTML = `
    <div style="display:flex; align-items:center; gap:16px; margin-bottom:20px;">
      <div style="width:56px; height:56px; border-radius:50%; background:#ecfdf5; color:#059669; font-size:28px; display:grid; place-items:center;">🏛️</div>
      <div>
        <h3 style="font-size:1.2rem; font-weight:800; color:#0f172a;">${escapeHtml(item.name)}</h3>
        <span class="status-badge ${item.status || 'active'}">${escapeHtml(item.status || 'active')}</span>
      </div>
    </div>
    <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px; background:#f8faf8; padding:16px; border-radius:12px;">
      <div><strong>Contact Person:</strong><br>${escapeHtml(item.contactPerson)}</div>
      <div><strong>Email:</strong><br>${escapeHtml(item.email)}</div>
      <div><strong>Phone:</strong><br>${escapeHtml(item.phone)}</div>
      <div><strong>Location:</strong><br>📍 ${escapeHtml(item.location)}</div>
      <div><strong>Registration number:</strong><br><code>${escapeHtml(item.taxId || 'Unavailable')}</code></div>
      <div><strong>Registered Date:</strong><br>${escapeHtml(item.regDate)}</div>
    </div>
  `;

  footer.innerHTML = `
    <button type="button" class="btn-secondary modal-close-btn">Close</button>
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
      <td><strong>${d.totalDonations == null ? 'Unavailable' : `${Number(d.totalDonations).toLocaleString()} listings`}</strong></td>
      <td><span class="status-badge verified">${escapeHtml(d.status)}</span></td>
      <td>${escapeHtml(d.regDate)}</td>
      <td style="text-align: right;">
        <button type="button" class="icon-action-btn" title="View Donor">👁️</button>
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

  container.innerHTML = state.pickups.length ? state.pickups.map(p => `
    <div class="timeline-card">
      <div class="timeline-card-header">
        <span class="pickup-id-badge">Pickup #${escapeHtml(p.id)} · Donation #${escapeHtml(p.donationId)}</span>
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
          <span class="node-sub">${escapeHtml(p.receiverName || 'Unavailable')}</span>
        </div>
      </div>

      <div class="timeline-meta-box">
        <div class="meta-item">
          <span>Partner NGO</span>
          <strong>${escapeHtml(p.ngoName)}</strong>
        </div>
        <div class="meta-item">
          <span>Last recorded update</span>
          <strong>${escapeHtml(p.eta || 'Unavailable')}</strong>
        </div>
      </div>
    </div>
  `).join('') : '<div class="account-empty">No pickup records are available.</div>';
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

  // Broadcast Notification Modal
  $('#btn-broadcast-notif-trigger')?.addEventListener('click', () => $('#modal-broadcast-notif')?.classList.add('show'));
  $('#form-broadcast-notif')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const targetRole = $('#broadcast-target').value;
    try {
      const response = await request('/api/admin/notifications', { method: 'POST', body: { title: $('#broadcast-title').value.trim(), message: $('#broadcast-body').value.trim(), targetRole } });
      closeModals(); e.currentTarget.reset(); await fetchBackendData(); toast(response.message || 'Notification sent.', 'success');
    } catch (error) { notifyError(error); }
  });
}

/* ============================================================
   11. QUICK ACTIONS PANEL TRIGGERS
   ============================================================ */
function initQuickActionButtons() {
  $('#qa-manage-ngos')?.addEventListener('click', () => {
    $(`.sidebar-nav .nav-item[data-tab="ngos"]`)?.click();
  });
  $('#qa-manage-users')?.addEventListener('click', () => {
    $(`.sidebar-nav .nav-item[data-tab="accounts"]`)?.click();
  });
  $('#qa-view-reports')?.addEventListener('click', () => {
    $(`.sidebar-nav .nav-item[data-tab="analytics"]`)?.click();
  });
  $('#qa-broadcast-notif')?.addEventListener('click', () => $('#modal-broadcast-notif')?.classList.add('show'));
  
}

/* ============================================================
   12. CHART.JS ANALYTICS INITIALIZATION
   ============================================================ */
function initAnalyticsCharts() {
  if (typeof Chart === 'undefined') return;
  const charts = [
    ['chart-donations-over-time', 'line', '#166534'],
    ['chart-rescued-by-month', 'bar', '#10b981'],
    ['chart-donations-category', 'doughnut', null],
    ['chart-outcome-breakdown', 'pie', null]
  ];
  for (const [id, type, color] of charts) {
    const canvas = $(`#${id}`);
    if (!canvas) continue;
    canvas._adminChart = new Chart(canvas, {
      type,
      data: { labels: [], datasets: [{ label: 'Database records', data: [], ...(color ? { borderColor: color, backgroundColor: type === 'line' ? 'rgba(22,101,52,.12)' : color, fill: type === 'line', tension: .35, borderWidth: 3 } : { backgroundColor: ['#166534', '#10b981', '#f59e0b', '#3b82f6', '#ef4444', '#94a3b8'] }) }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: type === 'doughnut' || type === 'pie' } } }
    });
  }
}

function updateAnalyticsCharts(analytics = {}) {
  const set = (id, labels, values, label) => {
    const chart = $(`#${id}`)?._adminChart;
    if (!chart) return;
    chart.data.labels = labels;
    chart.data.datasets[0].data = values;
    chart.data.datasets[0].label = label;
    chart.update();
  };
  const growth = analytics.donationGrowth || [];
  set('chart-donations-over-time', growth.map(row => row.month), growth.map(row => Number(row.donations || 0)), 'Donations posted');
  const outcomes = analytics.monthlyPerformance || [];
  set('chart-rescued-by-month', outcomes.map(row => row.month), outcomes.map(row => Number(row.completed || 0)), 'Completed donations');
  const categories = analytics.categoryDistribution || [];
  set('chart-donations-category', categories.map(row => row.name), categories.map(row => Number(row.donations || 0)), 'Donations by category');
  const live = analytics.liveStatus || {};
  set('chart-outcome-breakdown', ['Available', 'In progress', 'Completed'], [Number(live.available_donations || 0), Number(live.active_operations || 0), Number(live.completed_donations || 0)], 'Current donation status');
}

/* ============================================================
   13. BACKEND API INTEGRATION (OPTIONAL REFRESH)
   ============================================================ */
async function fetchBackendData() {
  try {
    const [dashboard, donationsResponse, businessesResponse, ngosResponse, notificationsResponse, logsResponse, analyticsResponse, userNotifications, pickupsResponse] = await Promise.all([
      request('/api/admin/dashboard'), request('/api/admin/donations?limit=100'), request('/api/admin/businesses?limit=100'),
      request('/api/admin/ngos?limit=100'), request('/api/admin/notifications?limit=50'), request('/api/admin/activity-logs?limit=50'), request('/api/admin/analytics'), request('/api/notifications'), request('/api/admin/pickups?limit=100')
    ]);
    const unreadCount = Number(userNotifications.unreadCount || 0);
    ['#sidebar-notif-count', '#topbar-notif-badge'].forEach(selector => {
      const badge = $(selector);
      if (badge) { badge.textContent = String(unreadCount); badge.hidden = unreadCount === 0; }
    });
    if (dashboard?.dashboard) {
      const metrics = dashboard.dashboard;
      $('#kpi-total-donations').textContent = Number(metrics.total_donations || 0).toLocaleString();
      $('#kpi-food-rescued').textContent = Number(metrics.meals_rescued || 0).toLocaleString();
      $('#kpi-registered-ngos').textContent = Number(metrics.total_ngos || 0).toLocaleString();
      $('#kpi-active-rescues').textContent = Number(metrics.pending_deliveries || 0).toLocaleString();
      $('#kpi-completed-pickups').textContent = Number(metrics.completed_deliveries || 0).toLocaleString();
      $('#sidebar-donations-count').textContent = Number(metrics.total_donations || 0).toLocaleString();
      $('#sidebar-rescued-value').textContent = `${Number(metrics.meals_rescued || 0).toLocaleString()} meals served`;
    }
    if (analyticsResponse?.analytics?.liveStatus) $('#kpi-active-donations').textContent = Number(analyticsResponse.analytics.liveStatus.available_donations || 0).toLocaleString();
    updateAnalyticsCharts(analyticsResponse?.analytics || {});
    const safeDate = value => value ? new Date(value).toLocaleDateString() : '—';
    state.donations = (donationsResponse.donations || []).map(d => ({ id: String(d.id), donor: d.business_name || 'Business partner', foodName: d.food_name || 'Food donation', category: d.category_name || 'Uncategorised', quantity: d.quantity || '—', location: d.pickup_city || d.business_city || '—', postedDate: safeDate(d.created_at), expiryText: d.expiry_time ? `Recorded deadline: ${safeDate(d.expiry_time)}` : 'Deadline unavailable', assignedNgo: d.ngo_name || 'Unassigned', status: d.status || 'available' }));
    state.donors = (businessesResponse.businesses || []).map(b => ({ id: String(b.id), name: b.business_name || b.full_name || 'Business partner', category: b.role || 'business', email: b.email || '—', phone: b.mobile || '—', location: b.city || '—', totalDonations: null, status: b.account_status || 'pending', regDate: safeDate(b.created_at) }));
    const mappedNgos = (ngosResponse.ngos || []).map(n => ({ id: String(n.id), name: n.ngo_name || n.full_name || 'NGO', contactPerson: n.full_name || '—', email: n.email || '—', phone: n.mobile || '—', location: n.city || '—', taxId: n.registration_number || '—', status: n.account_status === 'active' ? 'verified' : (n.account_status || 'pending'), claimedCount: null, regDate: safeDate(n.created_at) }));
    state.pendingNgos = mappedNgos.filter(n => n.status === 'pending');
    state.ngos = mappedNgos.filter(n => n.status !== 'pending');
    const pickupStep = status => ['delivered', 'completed'].includes(status) ? 3 : ['pickup_started', 'food_collected', 'on_the_way'].includes(status) ? 2 : ['pickup_scheduled', 'volunteer_assigned'].includes(status) ? 1 : 0;
    state.pickups = (pickupsResponse.pickups || []).map(p => ({ id: String(p.id), donationId: String(p.donation_id), donorName: p.donor_name || 'Unavailable', ngoName: p.ngo_name || 'Unavailable', receiverName: p.distribution_location || 'Unavailable', eta: p.updated_at ? safeDate(p.updated_at) : 'Unavailable', step: pickupStep(p.status), status: p.status === 'volunteer_assigned' ? 'pickup_scheduled' : p.status }));
    const pickupSummary = pickupsResponse.summary || {};
    $('#pickup-count-pending').textContent = Number(pickupSummary.pending || 0).toLocaleString();
    $('#pickup-count-assigned').textContent = Number(pickupSummary.assigned || 0).toLocaleString();
    $('#pickup-count-progress').textContent = Number(pickupSummary.in_progress || 0).toLocaleString();
    $('#pickup-count-today').textContent = Number(pickupSummary.completed_today || 0).toLocaleString();
    state.alerts = (notificationsResponse.notifications || []).map(n => ({ id: String(n.id), priority: n.notification_type === 'urgent' ? 'high' : 'low', title: n.title || 'Food Rescue alert', body: n.message || '', time: safeDate(n.created_at || n.createdAt) }));
    state.activityLogs = (logsResponse.logs || []).map(l => ({ actor: l.actor_name || l.actor || 'System', action: l.action || 'Activity recorded', time: safeDate(l.created_at) }));
    renderAllDonations(); renderPendingNgos(); renderAllNgos(); renderDonors(); renderPickupsTimeline(); renderAlertFeed(); renderActivityLogs();
  } catch (err) {
    console.error('Admin data could not be loaded.', err);
    notifyError(err);
  }
}
