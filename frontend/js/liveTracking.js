import { notifyError, request } from './api.js';
import { escapeHtml, toast } from './utils.js';

let leafletLoaded = false;
const loadLeaflet = async () => {
  if (leafletLoaded || window.L) return;
  if (!document.querySelector('link[href*="leaflet"]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    document.head.append(link);
  }
  await new Promise((resolve, reject) => {
    if (document.querySelector('script[src*="leaflet.js"]')) return resolve();
    const script = Object.assign(document.createElement('script'), {
      src: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
      onload: resolve,
      onerror: reject
    });
    document.head.append(script);
  });
  leafletLoaded = true;
};

let activeTrackingMap = null;
let trackingInterval = null;
let volunteerWatchId = null;

export const openLiveTracker = async (pickupId) => {
  try {
    await loadLeaflet();
    let modal = document.getElementById('tracking-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'tracking-modal';
      modal.className = 'fb-modal-backdrop';
      modal.innerHTML = `
        <div class="fb-modal-window">
          <header class="fb-modal-header">
            <h3>🚚 Live Pickup & Delivery Tracking</h3>
            <button type="button" class="fb-modal-close" data-action="close-tracker">&times;</button>
          </header>
          <div class="fb-modal-body">
            <div id="tracker-status-bar" class="tracker-status-bar">Connecting to live GPS…</div>
            <div id="leaflet-tracker-map" style="height: 380px; width: 100%; border-radius: 12px; margin-top: 10px;"></div>
            <div id="tracker-details" class="tracker-details"></div>
          </div>
        </div>
      `;
      document.body.append(modal);

      modal.querySelector('[data-action="close-tracker"]').addEventListener('click', () => {
        modal.classList.remove('active');
        if (trackingInterval) clearInterval(trackingInterval);
      });
    }

    modal.classList.add('active');

    const refreshTracking = async () => {
      try {
        const response = await request(`/api/pickups/track/${pickupId}`);
        const t = response.tracking;
        if (!t) return;

        const statusBar = document.getElementById('tracker-status-bar');
        const details = document.getElementById('tracker-details');
        const statusValue = /^[a-z_]+$/i.test(String(t.status || '')) ? String(t.status).toLowerCase() : 'pending';
        const statusClean = escapeHtml(statusValue.replaceAll('_', ' ').toUpperCase());

        statusBar.innerHTML = `<strong>Status:</strong> <span class="status-pill status-${statusValue}">${statusClean}</span> &bull; <strong>Food:</strong> ${escapeHtml(t.foodName)} (${escapeHtml(t.quantity)})`;

        let volunteerHtml = '<p><em>Waiting for delivery assignment…</em></p>';
        if (t.volunteer) {
          const phone = String(t.volunteer.phone || '').replace(/[^+\d]/g, '');
          volunteerHtml = `
            <div class="tracker-card">
              <h4>🚚 Rescue Driver: ${escapeHtml(t.volunteer.name)} (${escapeHtml(t.volunteer.vehicleType || 'Vehicle')})</h4>
              <p>📞 Phone: ${phone ? `<a href="tel:${escapeHtml(phone)}">${escapeHtml(t.volunteer.phone)}</a>` : 'Available on request'}</p>
              <p>📍 Distance: <strong>${t.volunteer.distanceKm !== null ? t.volunteer.distanceKm + ' km' : 'Calculating…'}</strong> &bull; ETA: <strong>${t.volunteer.etaMinutes ? t.volunteer.etaMinutes + ' mins' : 'En route'}</strong></p>
            </div>
          `;
        }

        details.innerHTML = `
          <div class="tracker-route-grid">
            <div class="tracker-point">
              <strong>🏢 Pickup Origin:</strong>
              <p>${escapeHtml(t.origin.name)} - ${escapeHtml(t.origin.address)}</p>
            </div>
            <div class="tracker-point">
              <strong>🏥 Delivery Destination:</strong>
              <p>${escapeHtml(t.destination.name)} - ${escapeHtml(t.destination.address)}</p>
            </div>
          </div>
          ${volunteerHtml}
        `;

        // Render Leaflet Map
        const mapContainer = document.getElementById('leaflet-tracker-map');
        if (!activeTrackingMap) {
          activeTrackingMap = window.L.map(mapContainer).setView([17.3850, 78.4867], 13);
          window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors'
          }).addTo(activeTrackingMap);
        }

        // Clear existing markers
        if (activeTrackingMap._fbLayer) {
          activeTrackingMap.removeLayer(activeTrackingMap._fbLayer);
        }
        activeTrackingMap._fbLayer = window.L.layerGroup().addTo(activeTrackingMap);

        const markers = [];
        // Origin Pin
        if (t.origin.latitude && t.origin.longitude) {
          const originMarker = window.L.marker([t.origin.latitude, t.origin.longitude], {
            title: 'Pickup Location'
          }).bindPopup(`<b>🏢 ${escapeHtml(t.origin.name)}</b><br>${escapeHtml(t.origin.address)}`);
          originMarker.addTo(activeTrackingMap._fbLayer);
          markers.push([t.origin.latitude, t.origin.longitude]);
        }

        // Destination Pin
        if (t.destination.latitude && t.destination.longitude) {
          const destMarker = window.L.marker([t.destination.latitude, t.destination.longitude], {
            title: 'Destination NGO'
          }).bindPopup(`<b>🏥 ${t.destination.name}</b><br>${t.destination.address}`);
          destMarker.addTo(activeTrackingMap._fbLayer);
          markers.push([t.destination.latitude, t.destination.longitude]);
        }

        // Rescue Driver Vehicle Pin
        if (t.volunteer && t.volunteer.currentLatitude && t.volunteer.currentLongitude) {
          const volMarker = window.L.marker([t.volunteer.currentLatitude, t.volunteer.currentLongitude], {
            title: 'Rescue Driver Live Location'
          }).bindPopup(`<b>🚚 Driver: ${t.volunteer.name}</b><br>Speed ~ 25km/h`);
          volMarker.addTo(activeTrackingMap._fbLayer);
          markers.push([t.volunteer.currentLatitude, t.volunteer.currentLongitude]);
        }

        if (markers.length > 0) {
          activeTrackingMap.fitBounds(markers, { padding: [40, 40] });
        }
        setTimeout(() => activeTrackingMap.invalidateSize(), 200);
      } catch (err) {
        console.error('Tracking fetch error:', err);
      }
    };

    await refreshTracking();
    if (trackingInterval) clearInterval(trackingInterval);
    trackingInterval = setInterval(refreshTracking, 10000); // 10s live polling
  } catch (error) {
    notifyError(error);
  }
};

/**
 * Starts volunteer background GPS broadcaster for their active pickup
 */
export const startVolunteerGpsBroadcaster = (pickupId) => {
  if (!navigator.geolocation) return;
  if (volunteerWatchId !== null) navigator.geolocation.clearWatch(volunteerWatchId);

  volunteerWatchId = navigator.geolocation.watchPosition(
    async position => {
      try {
        const { latitude, longitude } = position.coords;
        await request(`/api/pickups/location/${pickupId}`, {
          method: 'PUT',
          body: { latitude, longitude }
        });
      } catch (err) {
        console.warn('GPS location update failed:', err);
      }
    },
    error => console.warn('GPS watcher error:', error.message),
    { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 }
  );
};
