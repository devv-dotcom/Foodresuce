import { getSession, notifyError, request } from './api.js';
import { $, escapeHtml, setLoading, toast } from './utils.js';

const timeline = donation => {
  const pickup = donation.pickup || {};
  const status = pickup.status || donation.status;
  const ordered = ['available', 'accepted', 'pickup_scheduled', 'pickup_started', 'food_collected', 'distributed', 'completed'];
  const legacyAliases = { pending: donation.status, volunteer_assigned: 'pickup_started', picked_up: 'food_collected', delivered: 'distributed' };
  const current = legacyAliases[status] || status;
  const index = Math.max(0, ordered.indexOf(current));
  return ordered.map((stage, i) => `<div class="detail-stage ${i <= index ? 'done' : ''}">${i < index ? '✓ ' : i === index ? '● ' : '○ '}${escapeHtml(stage.replaceAll('_', ' ').replace(/^./, c => c.toUpperCase()))}</div>`).join('');
};

export const initDonationDetails = async () => {
  if (!document.body.hasAttribute('data-donation-details')) return;
  const params = new URLSearchParams(location.search);
  const id = params.get('id');
  const back = $('#detail-back');
  const requestedReturn = params.get('return') || '';
  const allowedReturn = /^\/(?:business|ngo)\/dashboard\.html(?:#[-\w]+)?$/.test(requestedReturn);
  if (back && allowedReturn) back.href = requestedReturn;
  if (!/^\d+$/.test(id || '') || Number(id) < 1) {
    $('#detail-content').innerHTML = '<p class="detail-error">This donation link is invalid. Return to your dashboard and open a donation from the list.</p>';
    return;
  }
  try {
    const { donation } = await request(`/api/donations/${encodeURIComponent(id)}`);
    const { user } = getSession();
    const images = (donation.images || []).map(image => `<img class="detail-image" src="${escapeHtml(image.image_path)}" alt="${escapeHtml(donation.food_name)}" loading="lazy">`).join('');
    const pickup = donation.pickup || {};
    const status = pickup.status || donation.status || 'available';
    $('#detail-status').textContent = status.replaceAll('_', ' ');
    $('#detail-content').innerHTML = `
      <div class="detail-grid">
        <div>${images || '<div class="detail-image" role="img" aria-label="No food photo available" style="min-height:180px;display:grid;place-items:center;color:#64748b;">No food photo available</div>'}</div>
        <div>
          <h1>${escapeHtml(donation.food_name || 'Food donation')}</h1>
          <p><strong>Donor:</strong> ${escapeHtml(donation.business_name || donation.owner_name || 'Food donor')}</p>
          <p><strong>Category:</strong> ${escapeHtml(donation.category_name || '—')} · <strong>Type:</strong> ${escapeHtml(donation.food_type || '—')}</p>
          <p><strong>Quantity:</strong> ${escapeHtml(donation.quantity || '—')} ${donation.number_of_meals ? `· ${Number(donation.number_of_meals).toLocaleString()} approx. meals` : ''}</p>
          <p><strong>Pickup:</strong> ${escapeHtml([donation.pickup_address, donation.pickup_city || donation.business_city].filter(Boolean).join(', ') || '—')}</p>
          <p><strong>Expires:</strong> ${escapeHtml(donation.countdown_text || new Date(donation.expiry_time).toLocaleString())}</p>
          <p>${escapeHtml(donation.description || '')}</p>
          ${user?.role === 'ngo' && donation.status === 'available' ? '<button type="button" class="btn-accept" data-detail-accept>Accept Donation</button>' : ''}
        </div>
      </div>
      <h2>Donation Timeline</h2>
      <div class="detail-timeline">${timeline(donation)}</div>
      ${pickup.people_served ? `<p><strong>People served:</strong> ${Number(pickup.people_served).toLocaleString()}</p>` : ''}
      ${pickup.distribution_location ? `<p><strong>Distribution location:</strong> ${escapeHtml(pickup.distribution_location)}</p>` : ''}
    `;
    $('[data-detail-accept]')?.addEventListener('click', async event => {
      const button = event.currentTarget;
      try {
        setLoading(button, true, 'Accepting…');
        await request(`/api/ngo/accept/${encodeURIComponent(id)}`, { method: 'POST' });
        toast('Donation accepted. It is now in your accepted donations.', 'success');
        button.remove();
        $('#detail-status').textContent = 'accepted';
      } catch (error) { notifyError(error); } finally { setLoading(button, false); }
    });
  } catch (error) {
    const content = $('#detail-content');
    if (content) content.innerHTML = `<p class="detail-error">${escapeHtml(error.message || 'Donation details could not be loaded.')}</p>`;
    notifyError(error);
  }
};
