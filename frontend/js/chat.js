import { getSession, notifyError, request } from './api.js';
import { escapeHtml, toast } from './utils.js';

let activeDonationId = null;
let pollId = null;

const close = () => {
  document.getElementById('donation-chat-modal')?.remove();
  activeDonationId = null;
  if (pollId) window.clearInterval(pollId);
  pollId = null;
};

const render = async () => {
  if (!activeDonationId) return;
  const modal = document.getElementById('donation-chat-modal');
  if (!modal) return close();
  const response = await request(`/api/chat/${activeDonationId}`);
  const me = Number(getSession().user?.id);
  modal.querySelector('[data-chat-title]').textContent = `${response.conversation.foodName} · Chat`;
  modal.querySelector('[data-chat-unread]').textContent = response.unreadCount ? `${response.unreadCount} unread` : '';
  const list = modal.querySelector('[data-chat-messages]');
  list.innerHTML = response.messages.length
    ? response.messages.map(message => `<div style="max-width:80%; padding:9px 11px; border-radius:12px; margin:${Number(message.sender_user_id) === me ? '8px 0 8px auto; background:#dcfce7' : '8px auto 8px 0; background:#f1f5f9'}"><strong style="font-size:.76rem">${escapeHtml(message.sender_name)}</strong><div>${escapeHtml(message.body)}</div><small style="color:#64748b">${new Date(message.created_at).toLocaleString()}</small></div>`).join('')
    : '<p style="color:#64748b; text-align:center">No messages yet. Coordinate this rescue here.</p>';
  list.scrollTop = list.scrollHeight;
};

export const initDonationChat = () => {
  document.addEventListener('click', async event => {
    const button = event.target.closest('[data-action="open-chat"]');
    if (!button) return;
    event.preventDefault();
    close();
    activeDonationId = button.dataset.id;
    const modal = document.createElement('div');
    modal.id = 'donation-chat-modal';
    modal.style.cssText = 'position:fixed;inset:0;z-index:1000;background:rgba(15,23,42,.45);display:grid;place-items:center;padding:16px';
    modal.innerHTML = `<section style="width:min(100%,620px);height:min(78vh,620px);background:#fff;border-radius:18px;box-shadow:0 20px 60px rgba(0,0,0,.25);display:flex;flex-direction:column;overflow:hidden"><header style="padding:15px 18px;border-bottom:1px solid #e2e8f0;display:flex;gap:10px;align-items:center"><strong data-chat-title>Donation chat</strong><small data-chat-unread style="margin-left:auto;color:#b45309"></small><button type="button" data-chat-close aria-label="Close chat">×</button></header><div data-chat-messages style="flex:1;overflow:auto;padding:14px"></div><form data-chat-form style="border-top:1px solid #e2e8f0;padding:12px;display:flex;gap:8px"><input name="message" maxlength="2000" required placeholder="Write a message…" style="flex:1;padding:10px;border:1px solid #cbd5e1;border-radius:10px"><button style="padding:10px 16px;border:0;border-radius:10px;background:#166534;color:#fff;font-weight:700">Send</button></form></section>`;
    document.body.append(modal);
    modal.querySelector('[data-chat-close]').addEventListener('click', close);
    modal.addEventListener('click', e => { if (e.target === modal) close(); });
    modal.querySelector('[data-chat-form]').addEventListener('submit', async e => {
      e.preventDefault();
      const form = e.currentTarget;
      const message = form.elements.message.value.trim();
      if (!message) return;
      try {
        form.querySelector('button').disabled = true;
        await request(`/api/chat/${activeDonationId}/messages`, { method: 'POST', body: { message } });
        form.reset();
        await render();
      } catch (error) { notifyError(error); } finally { form.querySelector('button').disabled = false; }
    });
    try {
      await render();
      pollId = window.setInterval(() => render().catch(() => {}), 15000);
    } catch (error) { notifyError(error); close(); }
  });
};
