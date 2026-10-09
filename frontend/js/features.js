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
      const unread = rows.filter(row => !row.is_read).length;

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
              try {
                await request(`/api/notifications/${encodeURIComponent(row.id)}/read`, { method: 'PATCH' });
                row.is_read = true;
                item.classList.remove('unread');
                item.classList.add('read');
                refresh();
              } catch (error) { console.warn('Could not mark notification as read:', error.message); }
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

  const checkEmergency = async () => {
    try {
      const response = await request('/api/donations/emergency', { auth: false });
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

    const { mapData } = await request('/api/analytics/map-data', { auth: false });
    if (!mapData) return;

    mapContainers.forEach(container => {
      const map = window.L.map(container, { scrollWheelZoom: false }).setView([20.5937, 78.9629], 5);
      window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap'
      }).addTo(map);

      const markers = [];

      // 1. Donations (Red if urgent, Yellow/Orange if available)
      (mapData.donations || []).forEach(d => {
        if (!d.latitude || !d.longitude) return;
        const color = d.is_urgent ? '#e11d48' : '#eab308';
        const label = d.is_urgent ? '🚨 Urgent Food Donation' : '🍲 Food Donation';

        const circle = window.L.circleMarker([d.latitude, d.longitude], {
          radius: d.is_urgent ? 10 : 7,
          fillColor: color,
          color: '#fff',
          weight: 2,
          opacity: 1,
          fillOpacity: 0.85
        }).addTo(map);

        circle.bindPopup(`
          <b>${label}</b><br>
          <strong>${escapeHtml(d.food_name)}</strong> (${d.quantity})<br>
          Donor: ${escapeHtml(d.donor_name || 'Business')}<br>
          City: ${escapeHtml(d.city || '')}
        `);
        markers.push([d.latitude, d.longitude]);

        // Simulated heat circle radius around donation hotspots
        window.L.circle([d.latitude, d.longitude], {
          radius: 1200,
          color: color,
          fillColor: color,
          fillOpacity: 0.15,
          weight: 1
        }).addTo(map);
      });

      // 2. Active NGOs (Green pins)
      (mapData.ngos || []).forEach(ngo => {
        if (!ngo.latitude || !ngo.longitude) return;
        const ngoMarker = window.L.circleMarker([ngo.latitude, ngo.longitude], {
          radius: 8,
          fillColor: '#16a34a',
          color: '#fff',
          weight: 2,
          opacity: 1,
          fillOpacity: 0.9
        }).addTo(map);

        ngoMarker.bindPopup(`<b>🏥 Active Partner NGO</b><br><strong>${escapeHtml(ngo.ngo_name)}</strong><br>${escapeHtml(ngo.city || '')}`);
        markers.push([ngo.latitude, ngo.longitude]);
      });

      if (markers.length > 0) {
        map.fitBounds(markers, { padding: [30, 30], maxZoom: 13 });
      }
      setTimeout(() => map.invalidateSize(), 300);
    });
  } catch (error) {
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
