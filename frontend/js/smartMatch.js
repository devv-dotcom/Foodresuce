import { notifyError, request } from './api.js';
import { toast, escapeHtml } from './utils.js';

export const openSmartMatchModal = async (donationId) => {
  try {
    let modal = document.getElementById('smart-match-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'smart-match-modal';
      modal.className = 'fb-modal-backdrop';
      modal.innerHTML = `
        <div class="fb-modal-window fb-smart-match-window">
          <header class="fb-modal-header">
            <h3>🤖 Smart Rescue Engine — AI Dispatch</h3>
            <button type="button" class="fb-modal-close" data-action="close-smart-match">&times;</button>
          </header>
          <div class="fb-modal-body" id="smart-match-content">
            <div class="loading-state">Analyzing proximity, NGO capacity, and availability…</div>
          </div>
        </div>
      `;
      document.body.append(modal);

      modal.querySelector('[data-action="close-smart-match"]').addEventListener('click', () => {
        modal.classList.remove('active');
      });
    }

    modal.classList.add('active');
    const container = document.getElementById('smart-match-content');
    container.innerHTML = '<div class="loading-state">Analyzing proximity, NGO capacity, and availability…</div>';

    const response = await request(`/api/donations/smart-match/${donationId}`);
    const { donation, recommendedNgo } = response;

    const urgencyTag = donation.isUrgent
      ? '<span class="status-pill status-cancelled">🚨 CRITICAL URGENCY (< 2.5h)</span>'
      : '<span class="status-pill status-available">⏳ Standard Freshness</span>';

    container.innerHTML = `
      <div class="smart-summary-box">
        <h4>🍛 ${escapeHtml(donation.foodName)} (${donation.quantity})</h4>
        <p>${urgencyTag} &bull; Hours Remaining: <strong>${donation.hoursRemaining}h</strong></p>
      </div>

      <div class="smart-recommendation-grid">
        <!-- Recommended NGO -->
        <div class="smart-match-card ngo-recommendation">
          <div class="match-badge">🏆 TOP MATCH NGO</div>
          <h3>${escapeHtml(recommendedNgo?.ngoName || 'Searching active NGOs…')}</h3>
          <div class="match-score-bar">
            <span>Match Compatibility</span>
            <strong>${recommendedNgo?.matchScore || 85}%</strong>
            <div class="progress-bar"><div style="width: ${recommendedNgo?.matchScore || 85}%;"></div></div>
          </div>
          <p>📍 Distance: <strong>${recommendedNgo?.distanceKm} km</strong></p>
          <p>⏱️ Turnaround ETA: <strong>~${recommendedNgo?.estimatedTransitMins} mins</strong></p>
          <p>📦 Active Rescues in Queue: ${recommendedNgo?.pendingRescues || 0}</p>
        </div>
      </div>

      <div class="smart-actions">
        <button type="button" class="btn-action" data-action="broadcast-urgent" data-id="${donation.id}">🚨 Broadcast Urgent Rescue Alert</button>
      </div>
    `;

    container.querySelector('[data-action="broadcast-urgent"]')?.addEventListener('click', async (e) => {
      try {
        e.target.disabled = true;
        e.target.textContent = 'Broadcasting…';
        await request(`/api/donations/emergency-broadcast/${donation.id}`, { method: 'POST' });
        toast('Emergency alert broadcasted to verified NGOs.');
        modal.classList.remove('active');
      } catch (err) {
        notifyError(err);
        e.target.disabled = false;
        e.target.textContent = '🚨 Broadcast Urgent Rescue Alert';
      }
    });

  } catch (error) {
    notifyError(error);
  }
};
