import { getSession, notifyError, request } from './api.js';
import { $, $$, escapeHtml, renderList, toast } from './utils.js';

const loadScript = src => new Promise((resolve, reject) => {
  if (document.querySelector(`script[src="${src}"]`)) return resolve();
  const script = Object.assign(document.createElement('script'), { src, onload: resolve, onerror: reject });
  document.head.append(script);
});

const loadCss = href => {
  if (document.querySelector(`link[href="${href}"]`)) return;
  const link = Object.assign(document.createElement('link'), { rel: 'stylesheet', href });
  document.head.append(link);
};

export const initTheme = () => {
  const key = 'foodbridge.theme';
  const set = theme => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(key, theme);
    $$('.theme-toggle').forEach(button => button.setAttribute('aria-pressed', String(theme === 'dark')));
  };
  set(localStorage.getItem(key) || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
  document.addEventListener('click', event => {
    if (event.target.closest('.theme-toggle')) set(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
  });
};

/**
 * Real-time Notifications: universal bell, drawer, unread counter, and mark read
 */
export const initNotifications = async () => {
  const bell = $('[data-notification-bell]');
  const list = $('[data-notification-list]');
  const drawer = $('[data-notification-drawer]');
  const summary = $('[data-notification-summary]');
  const markAllButton = $('[data-notification-read-all]');
  if (!getSession().token) return;

  const refresh = async () => {
    try {
      // Fetch user-specific notifications
      const response = await request('/api/notifications');
      const rows = response.notifications || [];
      const unread = Number.isFinite(Number(response.unreadCount))
        ? Number(response.unreadCount)
        : rows.filter(row => !row.is_read).length;

      if (bell) {
        bell.dataset.count = unread;
        bell.setAttribute('aria-label', `${unread} unread notifications`);
        let badge = bell.querySelector('.bell-badge');
        if (!badge) {
          badge = document.createElement('span');
          badge.className = 'bell-badge';
          bell.append(badge);
        }
        badge.textContent = unread > 0 ? (unread > 9 ? '9+' : unread) : '';
        badge.style.display = unread > 0 ? 'inline-block' : 'none';
      }

      if (summary) summary.textContent = unread ? `${unread} unread update${unread === 1 ? '' : 's'}` : 'You’re all caught up';
      if (markAllButton) markAllButton.disabled = unread === 0;

      if (list) {
        renderList(list, rows.slice(0, 10), row => {
          const item = document.createElement('li');
          item.className = `notification-item ${row.is_read ? 'read' : 'unread'}`;
          item.tabIndex = 0;
          item.setAttribute('role', 'button');
          const icon = ({ NEW_DONATION: '🍲', ASSIGNMENT_CREATED: '🚚', PICKUP_REMINDER: '⏰', DELIVERY_REMINDER: '📦', IMPACT_UPDATE: '🌱' })[row.type] || '🔔';
          const createdAt = new Date(row.created_at);
          const timestamp = Number.isNaN(createdAt.getTime()) ? '' : createdAt.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
          item.innerHTML = `
            <span class="notification-item-icon" aria-hidden="true">${icon}</span>
            <div class="notification-item-content">
              <strong>${escapeHtml(row.title || 'Food Rescue update')}</strong>
              <p>${escapeHtml(row.message || '')}</p>
              <small>${escapeHtml(timestamp)}</small>
            </div>
          `;
          const markRead = async () => {
            if (!row.is_read) {
              try { await request(`/api/notifications/${encodeURIComponent(row.id)}/read`, { method: 'PATCH' }); }
              catch (error) { return notifyError(error); }
              row.is_read = true;
              item.classList.remove('unread');
              item.classList.add('read');
              refresh();
            }
            if (row.related_donation_id) {
              const userRole = getSession().user?.role;
              const backPath = userRole === 'ngo' ? '/ngo/dashboard.html#active-rescues' : '/business/dashboard.html#donation-history';
              window.location.assign(`/donation-details.html?id=${encodeURIComponent(row.related_donation_id)}&return=${encodeURIComponent(backPath)}`);
            }
          };
          item.addEventListener('click', markRead);
          item.addEventListener('keydown', event => {
            if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); markRead(); }
          });
          return item;
        }, '<li class="notification-empty">No updates right now. New food listings and pickup activity will appear here.</li>');
      }
    } catch (error) {
      if (error.status !== 401 && error.status !== 403) {
        console.warn('Notifications poll:', error.message);
      }
    }
  };

  if (bell && drawer) {
    bell.addEventListener('click', () => {
      drawer.classList.toggle('active');
    });
  }

  markAllButton?.addEventListener('click', async () => {
    try {
      await request('/api/notifications/read-all', { method: 'PATCH' });
      await refresh();
    } catch (error) { notifyError(error); }
  });

  await refresh();
  window.setInterval(refresh, 12000); // 12 seconds live poll
};

/**
 * Real-time Expiry Countdown Timer
 * Continuously ticks every 10 seconds for all elements with data-expiry-time
 */
export const initExpiryCountdowns = () => {
  const tick = () => {
    const elements = $$('[data-expiry-time]');
    const now = Date.now();

    elements.forEach(el => {
      const expiry = new Date(el.dataset.expiryTime).getTime();
      if (!Number.isFinite(expiry)) return;

      const diffMs = expiry - now;
      if (diffMs <= 0) {
        el.innerHTML = '<span class="status-pill status-cancelled">⚠️ Expired</span>';
        el.classList.add('expired');
      } else {
        const totalMinutes = Math.floor(diffMs / 60000);
        const hours = Math.floor(totalMinutes / 60);
        const mins = totalMinutes % 60;
        const isUrgent = totalMinutes <= 150; // < 2.5 hours

        if (isUrgent) {
          el.innerHTML = `<span class="status-pill countdown-urgent">🚨 Urgent: ${hours}h ${mins}m left</span>`;
        } else {
          el.innerHTML = `<span class="status-pill countdown-normal">⏳ Best before: ${hours}h ${mins}m</span>`;
        }
      }
    });
  };

  tick();
  window.setInterval(tick, 10000);
};

/**
 * Emergency Food Alert: broadcasts red pulsing banner for urgent food (<2h)
 */
export const initEmergencyBanner = async () => {
  const banner = document.getElementById('emergency-alert-banner');
  if (!banner) return;
  const { token, user } = getSession();
  if (!token || !['ngo', 'admin'].includes(user?.role)) return;

  const checkEmergency = async () => {
    try {
      const response = await request('/api/donations/emergency');
      const urgents = response.donations || [];
      if (urgents.length > 0) {
        banner.hidden = false;
        banner.innerHTML = `
          <div class="emergency-content">
            <span class="pulse-dot"></span>
            <strong>🚨 EMERGENCY FOOD RESCUE NEEDED:</strong>
            <span>${urgents.length} donation(s) expiring within 2 hours! Immediate NGO pickup required.</span>
            <a href="#available-donations" class="btn-emergency-action">View Urgent Listings</a>
          </div>
        `;
      } else {
        banner.hidden = true;
      }
    } catch (err) {
      console.warn('Emergency check:', err.message);
    }
  };

  await checkEmergency();
  window.setInterval(checkEmergency, 20000);
};

/**
 * Interactive Leaflet Live Operations Map & Donation Heatmap
 */
export const initLiveOperationsMap = async () => {
  const mapContainers = $$('[data-live-map]');
  if (!mapContainers.length) return;

  try {
    loadCss('https://unpkg.com/leaflet@1.9.4/dist/leaflet.css');
    await loadScript('https://unpkg.com/leaflet@1.9.4/dist/leaflet.js');

    let mapData;
    const ngoMap = document.body.dataset.dashboard === 'ngo';
    if (ngoMap) {
      const status = $('#ngo-map-status');
      const { profile } = await request('/api/ngo/profile');
      const hasSavedCoordinates = profile?.latitude !== null && profile?.latitude !== undefined && profile?.longitude !== null && profile?.longitude !== undefined;
      let latitude = hasSavedCoordinates ? Number(profile.latitude) : Number.NaN;
      let longitude = hasSavedCoordinates ? Number(profile.longitude) : Number.NaN;
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
        if (status) status.textContent = 'Save your NGO location to see map results that match your food list. Use “Update location for nearby matching” above.';
        return;
      }
      const params = new URLSearchParams({ latitude, longitude, limit: '50' });
      const response = await request(`/api/ngo/donations?${params}`);
      mapData = { donations: response.donations || [], ngos: [] };
    } else {
      const response = await request('/api/analytics/map-data');
      mapData = response.mapData;
    }
    if (!mapData) return;

    mapContainers.forEach(container => {
      const map = window.L.map(container, { scrollWheelZoom: false }).setView([20.5937, 78.9629], 5);
      window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap'
      }).addTo(map);

      const markers = [];
      const donationLayers = [];

      // 1. Donations (Red if urgent, Yellow/Orange if available)
      (mapData.donations || []).forEach(d => {
        const latitude = Number(d.latitude);
        const longitude = Number(d.longitude);
        if (!Number.isFinite(latitude) || Math.abs(latitude) > 90 || !Number.isFinite(longitude) || Math.abs(longitude) > 180) return;
        const color = d.is_urgent ? '#e11d48' : d.status === 'accepted' ? '#2563eb' : '#eab308';
        const label = d.is_urgent ? '🚨 Urgent Food Donation' : '🍲 Food Donation';

        const circle = window.L.circleMarker([latitude, longitude], {
          radius: d.is_urgent ? 10 : 7,
          fillColor: color,
          color: '#fff',
          weight: 2,
          opacity: 1,
          fillOpacity: 0.85
        }).addTo(map);
        donationLayers.push({ id: String(d.id), layer: circle });

        const detailsUrl = ngoMap
          ? `/donation-details.html?id=${encodeURIComponent(d.id)}&return=${encodeURIComponent('/ngo/dashboard.html#available-donations')}`
          : '/admin/dashboard.html#donations';
        circle.bindPopup(`
          <b>${label}</b><br>
          <strong>${escapeHtml(d.food_name)}</strong><br>
          Quantity: ${escapeHtml(d.quantity || '')}<br>
          Pickup deadline: ${escapeHtml(new Date(d.expiry_time).toLocaleString())}<br>
          ${Number.isFinite(Number(d.distance_km)) ? `Distance: ${Number(d.distance_km).toFixed(1)} km<br>` : ''}
          <a href="${detailsUrl}" data-map-donation="${Number(d.id)}">View donation details</a>
        `);
        markers.push([latitude, longitude]);
      });

      // 2. Active NGOs (Green pins)
      (mapData.ngos || []).forEach(ngo => {
        const latitude = Number(ngo.latitude);
        const longitude = Number(ngo.longitude);
        if (!Number.isFinite(latitude) || Math.abs(latitude) > 90 || !Number.isFinite(longitude) || Math.abs(longitude) > 180) return;
        const ngoMarker = window.L.circleMarker([latitude, longitude], {
          radius: 8,
          fillColor: '#16a34a',
          color: '#fff',
          weight: 2,
          opacity: 1,
          fillOpacity: 0.9
        }).addTo(map);

        ngoMarker.bindPopup(`<b>🏥 Active Partner NGO</b><br><strong>${escapeHtml(ngo.ngo_name)}</strong><br>${escapeHtml(ngo.city || '')}`);
        markers.push([latitude, longitude]);
      });

      if (markers.length > 0) {
        map.fitBounds(markers, { padding: [30, 30], maxZoom: 13 });
      }
      const status = $('#ngo-map-status');
      if (ngoMap && status) status.textContent = markers.length ? `${markers.length} available donation(s) shown. The map refreshes with the dashboard.` : 'No available donations with map coordinates were found nearby.';
      setTimeout(() => map.invalidateSize(), 300);
      if (ngoMap) {
        const syncVisibleDonations = event => {
          const visibleIds = new Set((event?.detail?.ids || window.__ngoVisibleDonationIds || []).map(String));
          donationLayers.forEach(({ id, layer }) => {
            const shouldShow = visibleIds.has(id);
            if (shouldShow && !map.hasLayer(layer)) layer.addTo(map);
            if (!shouldShow && map.hasLayer(layer)) map.removeLayer(layer);
          });
        };
        window.addEventListener('ngo:donation-filters-changed', syncVisibleDonations);
        syncVisibleDonations();
      }
      map.on('popupopen', event => {
        const link = event.popup.getElement()?.querySelector('[data-map-donation]');
        if (!link || !ngoMap) return;
        link.addEventListener('click', () => {
          setTimeout(() => {
            const item = [...document.querySelectorAll('#available-donations [data-id]')]
              .find(element => String(element.dataset.id) === link.dataset.mapDonation);
            item?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }, 0);
        }, { once: true });
      });
    });
  } catch (error) {
    const status = $('#ngo-map-status');
    if (status && document.body.dataset.dashboard === 'ngo') status.textContent = 'The map could not be loaded. Retry by refreshing the page.';
    console.warn('Map initialization:', error.message);
  }
};

/**
 * Public dynamic impact numbers for landing page index.html
 */
export const initPublicImpactCounters = async () => {
  const impactSection = document.querySelector('.live-impact, .impact-strip');
  if (!impactSection) return;

  try {
    const { summary } = await request('/api/analytics/public', { auth: false });
    if (!summary) return;

    document.querySelectorAll('[data-public-metric]').forEach(el => {
      const value = Number(summary[el.dataset.publicMetric]);
      el.textContent = Number.isFinite(value) ? value.toLocaleString() : '—';
    });
  } catch (err) {
    console.warn('Public impact counters:', err.message);
  }
};

export const initDonationFilters = () => {
  const form = $('[data-donation-filters]');
  if (!form) return;
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const params = new URLSearchParams(new FormData(form));
    try {
      const response = await request(`/api/donations/filter?${params}`);
      renderList($('[data-filter-results]'), response.donations, row => {
        const item = document.createElement('article');
        item.innerHTML = `<strong>${escapeHtml(row.food_name)}</strong><span>${escapeHtml(row.business_city)} · ${escapeHtml(row.status)}</span>`;
        return item;
      }, 'No matching donations.');
    } catch (error) { notifyError(error); }
  });
};

export const initCharts = async () => {
  const canvases = $$('canvas[data-chart]');
  if (!canvases.length) return;
  try {
    await loadScript('https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js');
    const { analytics } = await request('/api/admin/analytics');
    canvases.forEach(canvas => {
      const source = analytics[canvas.dataset.chart] || [];
      const labels = source.map(row => row.month || row.name || row.city);
      const values = source.map(row => Number(row.donations ?? row.completed_deliveries ?? row.accepted_donations ?? 0));
      new window.Chart(canvas, {
        type: canvas.dataset.chartType || 'line',
        data: {
          labels,
          datasets: [{
            label: canvas.dataset.label || 'Activity',
            data: values,
            borderColor: '#96b43a',
            backgroundColor: 'rgba(150,180,58,.2)',
            fill: true,
            tension: .35
          }]
        },
        options: { responsive: true, plugins: { legend: { display: false } } }
      });
    });
  } catch (error) { notifyError(error); }
};

export const initPdfReports = () => document.addEventListener('click', async event => {
  const button = event.target.closest('[data-pdf-report]');
  if (!button) return;
  try {
    await loadScript('https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js');
    const response = await request(`/api/admin/reports?type=${encodeURIComponent(button.dataset.pdfReport)}`);
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF();
    pdf.setFontSize(18);
    pdf.text(`Food Rescue ${button.dataset.pdfReport} report`, 18, 22);
    pdf.setFontSize(11);
    pdf.text(pdf.splitTextToSize(JSON.stringify(response.report, null, 2), 170), 18, 36);
    pdf.save(`foodbridge-${button.dataset.pdfReport}-report.pdf`);
    toast('PDF report downloaded.');
  } catch (error) { notifyError(error); }
});
