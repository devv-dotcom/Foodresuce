import { getDonations, notifyError, request } from './api.js';
import { $, formDataObject, renderList, setLoading, toast, validateImage, wireImagePreview, escapeHtml } from './utils.js';

const donationItem = donation => {
  const row = document.createElement('article');
  row.style.cssText = 'display:flex; justify-content:space-between; align-items:center; padding:14px 18px; border:1px solid #e2e8f0; border-radius:12px; background:#fff; margin-bottom:10px; font-size:14px;';
  row.innerHTML = `<div><strong style="display:block; color:#1e293b;">${escapeHtml(donation.food_name || donation.foodName || 'Food Item')}</strong><span style="font-size:12px; color:#64748b;">${escapeHtml(donation.status || 'available')} · ${escapeHtml(donation.quantity || '')}</span></div>`;
  
  if (donation.status === 'available' || !donation.status) {
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.dataset.action = 'edit-donation';
    edit.dataset.id = donation.id;
    edit.textContent = 'Edit';
    edit.style.cssText = 'border:1px solid #86efac; background:#f0fdf4; color:#166534; border-radius:8px; padding:6px 12px; font:700 12px Manrope, sans-serif; cursor:pointer;';
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.dataset.action = 'delete-donation';
    remove.dataset.id = donation.id;
    remove.textContent = 'Cancel';
    remove.style.cssText = 'border:1px solid #fca5a5; background:#fff5f5; color:#dc2626; border-radius:8px; padding:6px 12px; font:700 12px Manrope, sans-serif; cursor:pointer;';
    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex; gap:8px;';
    actions.append(edit, remove);
    row.append(actions);
  }
  return row;
};

export const initDonationIntegration = () => {
  const imageInput = $('[data-donation-image]');
  const previewContainer = $('[data-donation-preview]');
  if (imageInput && previewContainer) {
    wireImagePreview(imageInput, previewContainer);
  }

  const form = $('[data-api-form="donation"]');
  let editingDonationId = null;
  const submitButton = form?.querySelector('[type="submit"]');
  const cancelEditButton = $('#cancel-donation-edit');
  form?.addEventListener('input', event => event.target.removeAttribute('aria-invalid'));
  form?.addEventListener('change', event => event.target.removeAttribute('aria-invalid'));

  const showEditor = () => {
    $('#donation-success-view')?.setAttribute('hidden', '');
    $('#donate-form-container')?.removeAttribute('hidden');
    form?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const resetEditor = () => {
    editingDonationId = null;
    form?.reset();
    if (submitButton) {
      submitButton.textContent = 'Submit Food Donation →';
      // setLoading restores this value after the submit handler's finally block.
      submitButton.dataset.originalLabel = 'Submit Food Donation →';
    }
    if (imageInput) imageInput.required = true;
    if (cancelEditButton) cancelEditButton.hidden = true;
    form?.querySelectorAll('input, select, textarea').forEach(field => {
      field.dispatchEvent(new Event('input', { bubbles: true }));
      field.dispatchEvent(new Event('change', { bubbles: true }));
    });
  };

  const toLocalDateTime = value => {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
    return date.toISOString().slice(0, 16);
  };

  const loadDonations = async () => {
    const response = await getDonations();
    renderList($('#donation-results'), response.donations, donationItem, 'No donations found.');
  };

  form?.addEventListener('submit', async event => {
    event.preventDefault();
    const submit = form.querySelector('[type="submit"]');
    const images = imageInput?.files ? [...imageInput.files] : [];
    const invalid = images.map(validateImage).find(Boolean);
    if (!editingDonationId && !images.length) return toast('Please add at least one food photo.', 'error');
    if (invalid) return toast(invalid, 'error');

    const formDetails = formDataObject(form);
    const data = new FormData();
    Object.entries(formDetails).forEach(([key, value]) => {
      if (!(value instanceof File)) data.append(key, value);
    });
    for (const field of ['preparationTime', 'expiryTime']) {
      const localDateTime = new Date(formDetails[field]);
      if (Number.isFinite(localDateTime.getTime())) data.set(field, localDateTime.toISOString());
    }
    const pickupDateTime = new Date(`${formDetails.pickupDate}T${formDetails.pickupTime}`);
    if (Number.isFinite(pickupDateTime.getTime())) data.append('pickupDateTime', pickupDateTime.toISOString());
    images.forEach(image => data.append('images', image));

    try {
      setLoading(submit, true, editingDonationId ? 'Saving changes…' : 'Submitting donation…');
      const response = editingDonationId
        ? await request(`/api/donations/${editingDonationId}`, { method: 'PUT', body: data, timeoutMs: 60000 })
        : await createDonation(data);
      const wasEditing = Boolean(editingDonationId);
      toast(wasEditing ? 'Donation updated successfully.' : 'Donation submitted successfully!', 'success');
      resetEditor();

      if (wasEditing) {
        await loadDonations();
        return;
      }

      // Clear local storage draft
      localStorage.removeItem('foodbridge_donation_draft');

      // Populate & Display Success View Screen
      const successView = $('#donation-success-view');
      const formContainer = $('#donate-form-container');
      const successId = $('#success-donation-id');
      const successName = $('#success-food-name');

      const refId = response.donation?.id ? `#FB-${10000 + response.donation.id}` : `#FB-${Math.floor(10000 + Math.random() * 90000)}`;
      if (successId) successId.textContent = refId;
      if (successName) successName.textContent = formDetails.foodName || 'Surplus Food';

      // Render Nearby Food Rescue Partners
      const nearbyListEl = $('#nearby-partners-list');
      if (nearbyListEl) {
        const partners = response.nearbyNGOs || [];
        if (partners.length > 0) {
          nearbyListEl.innerHTML = partners.map(ngo => `
            <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:12px; padding:14px 16px; display:flex; justify-content:space-between; align-items:center;">
              <div>
                <strong style="display:block; font-size:15px; color:#0f172a;">${escapeHtml(ngo.ngo_name)}</strong>
                <span style="font-size:13px; color:#166534; font-weight:600; display:inline-flex; align-items:center; gap:4px; margin-top:2px;">
                  📍 Approximately ${ngo.distance_km} km away
                </span>
                <span style="font-size:12px; color:#64748b; margin-left:8px;">(${escapeHtml(ngo.city)})</span>
              </div>
              <span style="background:#f0fdf4; color:#166534; border:1px solid #bbf7d0; padding:4px 10px; border-radius:20px; font-size:11px; font-weight:700;">
                Eligible Partner
              </span>
            </div>
          `).join('');
        } else {
          nearbyListEl.innerHTML = `
            <div style="background:#fffbebf8; border:1px solid #fef3c7; border-radius:12px; padding:16px;">
              <h4 style="font-size:15px; font-weight:700; color:#92400e; margin:0 0 4px;">No Nearby NGO Found Yet</h4>
              <p style="font-size:13px; color:#b45309; margin:0;">Your donation has still been submitted, and we'll continue looking for a suitable food rescue partner.</p>
            </div>
          `;
        }
      }

      if (formContainer) formContainer.hidden = true;
      if (successView) {
        successView.hidden = false;
        successView.scrollIntoView({ behavior: 'smooth' });
      }

      form.reset();

      // Trigger automatic reload of recent donations
      try {
        if ($('#donation-results')) await loadDonations();
      } catch (e) {
        console.warn('Could not reload recent donations list automatically:', e);
      }
    } catch (error) {
      notifyError(error);
    } finally {
      setLoading(submit, false);
    }
  });

  $('[data-action="load-donations"]')?.addEventListener('click', async () => {
    try {
      await loadDonations();
    } catch (error) {
      notifyError(error);
    }
  });

  document.addEventListener('click', async event => {
    const button = event.target.closest('[data-action="delete-donation"], [data-action="edit-donation"]');
    if (!button) return;
    const id = button.dataset.id;
    if (!id) return;

    try {
      if (button.dataset.action === 'delete-donation') {
        if (confirm('Cancel this donation? It will remain in your history.')) {
          await request(`/api/donations/${id}`, { method: 'DELETE' });
          toast('Donation cancelled. It remains in your history.');
          await loadDonations();
        }
      } else {
        const response = await request(`/api/donations/${id}`);
        const donation = response.donation;
        const values = {
          foodName: donation.food_name,
          categoryId: donation.category_id,
          foodType: donation.food_type,
          quantity: donation.quantity,
          numberOfMeals: donation.number_of_meals,
          preparationTime: toLocalDateTime(donation.preparation_time),
          expiryTime: toLocalDateTime(donation.expiry_time),
          pickupDate: String(donation.pickup_date || '').slice(0, 10),
          pickupTime: String(donation.pickup_time || '').slice(0, 5),
          pickupAddress: donation.pickup_address,
          city: donation.pickup_city || donation.business_city || '',
          pincode: donation.pickup_pincode || '',
          storage: donation.storage_condition || 'ambient',
          description: donation.description || ''
        };
        Object.entries(values).forEach(([name, value]) => {
          const field = form.elements.namedItem(name);
          if (field && value !== null && value !== undefined) field.value = value;
        });
        const declarations = {
          safetyHygiene: donation.safety_hygiene_confirmed,
          safetyFreshness: donation.safety_storage_confirmed,
          safetyPackaging: donation.safety_deadline_confirmed,
          safetyAccuracy: donation.safety_accuracy_confirmed
        };
        Object.entries(declarations).forEach(([name, value]) => {
          const field = form.elements.namedItem(name);
          if (field) field.checked = value === true || Number(value) === 1;
        });
        form.querySelectorAll('input, select, textarea').forEach(field => {
          field.dispatchEvent(new Event('input', { bubbles: true }));
          field.dispatchEvent(new Event('change', { bubbles: true }));
        });
        editingDonationId = id;
        // Existing donations can be updated without replacing their photo.
        if (imageInput) imageInput.required = false;
        if (submitButton) submitButton.textContent = 'Save Donation Changes →';
        if (cancelEditButton) cancelEditButton.hidden = false;
        showEditor();
        toast('Edit the details and re-confirm the food-handling checklist before saving.');
      }
    } catch (error) {
      notifyError(error);
    }
  });

  cancelEditButton?.addEventListener('click', () => {
    resetEditor();
    showEditor();
  });

  if ($('#donation-results')) {
    loadDonations().catch(notifyError);
  }
};
