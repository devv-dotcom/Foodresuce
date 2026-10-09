import { acceptDonation, notifyError, request } from './api.js';
import { $, escapeHtml, renderList, setLoading, toast } from './utils.js';

const pickupCard = donation => {
  const card = document.createElement('article');
  card.innerHTML = `<strong>${escapeHtml(donation.food_name)}</strong><span>${escapeHtml(donation.quantity)} · ${escapeHtml(donation.business_name || '')}</span><button type="button" data-action="accept-donation" data-id="${donation.id}">Accept</button>`;
  return card;
};

export const initNgoIntegration = () => {
  $('[data-action="load-available-donations"]')?.addEventListener('click', async () => {
    try { const response = await request('/api/ngo/donations'); renderList($('#available-donations'), response.donations, pickupCard, 'No donations are currently available.'); }
    catch (error) { notifyError(error); }
  });
  // The current NGO dashboard owns these actions in dashboard.js. Binding the
  // legacy handler there as well submits accept/confirm requests twice.
  if (document.body.matches('[data-dashboard="ngo"]')) return;
  document.addEventListener('click', async event => {
    const acceptBtn = event.target.closest('[data-action="accept-donation"]');
    if (acceptBtn) {
      try { setLoading(acceptBtn, true, 'Accepting…'); await acceptDonation(acceptBtn.dataset.id); toast('Donation accepted successfully.'); acceptBtn.closest('article')?.remove(); }
      catch (error) { notifyError(error); } finally { setLoading(acceptBtn, false); }
      return;
    }
    const confirmBtn = event.target.closest('[data-action="confirm-delivery"]');
    if (confirmBtn) {
      try {
        setLoading(confirmBtn, true, 'Confirming…');
        await request(`/api/ngo/confirm-delivery/${confirmBtn.dataset.id}`, { method: 'POST' });
        toast('Delivery confirmed! Donation is completed.');
        confirmBtn.disabled = true;
        confirmBtn.textContent = 'Completed';
      } catch (error) { notifyError(error); } finally { setLoading(confirmBtn, false); }
    }
  });
};
