import { getSession, notifyError, request } from './api.js';
import { escapeHtml } from './utils.js';

let activeDonationId = null;
let pollId = null;
let escapeHandler = null;

const close = () => {
  document.getElementById('donation-chat-modal')?.remove();
  activeDonationId = null;
  if (pollId) window.clearInterval(pollId);
  pollId = null;
  if (escapeHandler) document.removeEventListener('keydown', escapeHandler);
  escapeHandler = null;
};

const updateUnreadBadge = count => {
  const unread = Math.max(0, Number(count) || 0);
  document.querySelectorAll('[data-chat-unread-count]').forEach(badge => {
    badge.textContent = unread > 9 ? '9+' : String(unread);
    badge.hidden = unread === 0;
    badge.classList.toggle('chat-unread-badge', unread > 0);
  });
};

const createModal = (title, content) => {
  const modal = document.createElement('div');
  modal.id = 'donation-chat-modal';
  modal.setAttribute('role', 'presentation');
  modal.style.cssText = 'position:fixed;inset:0;z-index:2000;background:rgba(15,23,42,.45);display:grid;place-items:center;padding:16px';
  modal.innerHTML = `<section role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}" style="width:min(100%,620px);height:min(78vh,620px);background:#fff;border-radius:18px;box-shadow:0 20px 60px rgba(0,0,0,.25);display:flex;flex-direction:column;overflow:hidden">
    <header style="padding:15px 18px;border-bottom:1px solid #e2e8f0;display:flex;gap:10px;align-items:center">
      ${content.back ? '<button type="button" data-chat-inbox-back aria-label="Back to messages" style="background:#f1f5f9;color:#334155;padding:7px 10px">← Messages</button>' : ''}
      <strong data-chat-title>${escapeHtml(title)}</strong>
      <small data-chat-unread style="margin-left:auto;color:#b45309"></small>
      <button type="button" data-chat-close aria-label="Close messages">×</button>
    </header>
    ${content.body}
  </section>`;
  document.body.append(modal);
  modal.querySelector('[data-chat-close]').addEventListener('click', close);
  modal.addEventListener('click', event => { if (event.target === modal) close(); });
  escapeHandler = event => { if (event.key === 'Escape') close(); };
  document.addEventListener('keydown', escapeHandler);
  return modal;
};

const render = async () => {
  if (!activeDonationId) return;
  const modal = document.getElementById('donation-chat-modal');
  if (!modal) return close();
  const response = await request(`/api/chat/${encodeURIComponent(activeDonationId)}`);
  const me = Number(getSession().user?.id);
  modal.querySelector('[data-chat-title]').textContent = `${response.conversation.foodName} · Chat`;
  modal.querySelector('[data-chat-unread]').textContent = response.unreadCount ? `${response.unreadCount} unread` : '';
  const list = modal.querySelector('[data-chat-messages]');
  list.innerHTML = response.messages.length
    ? response.messages.map(message => `<div style="max-width:80%;padding:9px 11px;border-radius:12px;margin:${Number(message.sender_user_id) === me ? '8px 0 8px auto;background:#dcfce7' : '8px auto 8px 0;background:#f1f5f9'}"><strong style="font-size:.76rem">${escapeHtml(message.sender_name)}</strong><div>${escapeHtml(message.body)}</div><small style="color:#64748b">${escapeHtml(new Date(message.created_at).toLocaleString())}</small></div>`).join('')
    : '<p style="color:#64748b;text-align:center">No messages yet. Coordinate this rescue here.</p>';
  list.scrollTop = list.scrollHeight;
  try {
    const inbox = await request('/api/chat');
    updateUnreadBadge(inbox.unreadCount);
  } catch (_) { /* The open conversation remains usable if the unread summary fails. */ }
};

const openConversation = async (donationId, { fromInbox = false } = {}) => {
  close();
  activeDonationId = String(donationId);
  const modal = createModal('Donation chat', {
    back: fromInbox,
    body: `<div data-chat-messages style="flex:1;overflow:auto;padding:14px"></div>
      <form data-chat-form style="border-top:1px solid #e2e8f0;padding:12px;display:flex;gap:8px">
        <input name="message" maxlength="2000" required placeholder="Write a message…" aria-label="Message" style="min-width:0;flex:1;padding:10px;border:1px solid #cbd5e1;border-radius:10px">
        <button type="submit" style="padding:10px 16px;border:0;border-radius:10px;background:#166534;color:#fff;font-weight:700">Send</button>
      </form>`
  });
  modal.querySelector('[data-chat-inbox-back]')?.addEventListener('click', openInbox);
  modal.querySelector('[data-chat-form]').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('[type="submit"]');
    const message = form.elements.message.value.trim();
    if (!message) return;
    try {
      button.disabled = true;
      await request(`/api/chat/${encodeURIComponent(activeDonationId)}/messages`, { method: 'POST', body: { message } });
      form.reset();
      await render();
    } catch (error) { notifyError(error); }
    finally { button.disabled = false; }
  });
  try {
    await render();
    pollId = window.setInterval(() => render().catch(() => {}), 15000);
  } catch (error) { notifyError(error); close(); }
};

const openInbox = async () => {
  close();
  const modal = createModal('Messages', {
    body: '<div data-chat-inbox class="chat-inbox-list" aria-live="polite"><p class="chat-inbox-empty">Loading your conversations…</p></div>'
  });
  const list = modal.querySelector('[data-chat-inbox]');
  const refreshInbox = async () => {
    const response = await request('/api/chat');
    updateUnreadBadge(response.unreadCount);
    list.replaceChildren();
    if (!response.conversations?.length) {
      const empty = document.createElement('p');
      empty.className = 'chat-inbox-empty';
      empty.textContent = 'No conversations yet. Chat becomes available after an NGO accepts a donation. Open the chat button on an accepted rescue to start a conversation.';
      list.append(empty);
      return;
    }
    response.conversations.forEach(conversation => {
      const thread = document.createElement('button');
      thread.type = 'button';
      thread.className = 'chat-thread';
      thread.dataset.action = 'open-chat';
      thread.dataset.id = conversation.donation_id;
      const title = document.createElement('strong');
      title.textContent = `${conversation.food_name} · ${conversation.other_party_name}`;
      const preview = document.createElement('small');
      preview.textContent = conversation.last_message || 'Open conversation';
      const meta = document.createElement('small');
      const unread = Number(conversation.unread_count) || 0;
      meta.textContent = unread ? `${unread} unread` : (conversation.last_message_at ? new Date(conversation.last_message_at).toLocaleString() : 'No messages yet');
      thread.append(title, preview, meta);
      list.append(thread);
    });
  };
  try {
    await refreshInbox();
    pollId = window.setInterval(() => refreshInbox().catch(() => {}), 15000);
  } catch (error) {
    list.textContent = error.message || 'Messages could not be loaded. Please try again.';
    notifyError(error);
  }
};

export const initDonationChat = () => {
  if (!document.querySelector('[data-action="open-chat-inbox"], [data-action="open-chat"]')) return;

  document.addEventListener('click', event => {
    const inboxButton = event.target.closest('[data-action="open-chat-inbox"]');
    if (inboxButton) {
      event.preventDefault();
      openInbox();
      return;
    }
    const threadButton = event.target.closest('[data-action="open-chat"]');
    if (!threadButton) return;
    event.preventDefault();
    openConversation(threadButton.dataset.id, { fromInbox: threadButton.closest('[data-chat-inbox]') !== null });
  });

  request('/api/chat').then(response => updateUnreadBadge(response.unreadCount)).catch(() => {});
};
