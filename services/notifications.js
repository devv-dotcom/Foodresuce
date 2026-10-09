/**
 * Food Rescue Notification Store
 * --------------------------------------------------
 * Lightweight in-memory + file-persisted notification
 * system. Supports targeted recipient notifications, distance metadata,
 * and duplicate prevention.
 */

const fs   = require('fs');
const path = require('path');

const STORE_FILE = path.join(__dirname, '..', 'data', 'notifications.json');

function ensureDir() {
  const dir = path.dirname(STORE_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readAll() {
  ensureDir();
  try {
    return JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function writeAll(notifications) {
  ensureDir();
  const trimmed = notifications.slice(-300);
  fs.writeFileSync(STORE_FILE, JSON.stringify(trimmed, null, 2), 'utf8');
}

function uid() {
  return `ntf_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Push a new notification into the store.
 * Prevents duplicate notifications for same recipient & donation.
 */
function push(data) {
  const notifications = readAll();

  // Prevent duplicate notification for same recipient, donationId & type
  if (data.recipientUserId && data.donationId && data.type) {
    const exists = notifications.find(
      n => String(n.recipientUserId) === String(data.recipientUserId) &&
           String(n.donationId) === String(data.donationId) &&
           n.type === data.type
    );
    if (exists) return exists;
  }

  const entry = {
    id:              uid(),
    recipientUserId: data.recipientUserId ? String(data.recipientUserId) : null,
    targetRole:      data.targetRole || 'all',
    type:            data.type || 'NEW_DONATION',
    title:           data.title || '🍱 New Food Available',
    message:         data.body || data.message || '',
    body:            data.body || data.message || '',
    donationId:      data.donationId ? Number(data.donationId) : null,
    distanceKm:      data.distanceKm !== undefined ? data.distanceKm : null,
    donorName:       data.donorName || 'A Donor',
    foodName:        data.foodName || 'Food',
    quantity:        data.quantity || '',
    city:            data.city || '',
    expiryTime:      data.expiryTime || null,
    createdAt:       new Date().toISOString(),
    isRead:          false,
    readBy:          []
  };

  notifications.push(entry);
  writeAll(notifications);
  return entry;
}

/**
 * Get unread notifications relevant for a given user ID (NGO / Donor / Volunteer).
 */
function isVisibleTo(notification, userId, role) {
  if (notification.recipientUserId) return String(notification.recipientUserId) === String(userId);
  return notification.targetRole === 'all' || notification.targetRole === role;
}

function getUnread(userId, limit = 30, role = 'all') {
  const all = readAll();
  const sUserId = String(userId);
  return all
    .filter(n => {
      const isTarget = isVisibleTo(n, sUserId, role);
      const isUnread = !n.readBy.includes(sUserId);
      return isTarget && isUnread;
    })
    .slice(-limit)
    .reverse();
}

/**
 * Get all notifications for a specific user ID.
 */
function getForUser(userId, limit = 50, role = 'all') {
  const all = readAll();
  const sUserId = String(userId);
  return all
    .filter(n => isVisibleTo(n, sUserId, role))
    .map(n => ({
      ...n,
      isRead: n.readBy.includes(sUserId) || Boolean(n.isRead && !n.recipientUserId)
    }))
    .slice(-limit)
    .reverse();
}

function getRecent(limit = 50) {
  return readAll().slice(-limit).reverse();
}

function markRead(notifId, userId) {
  const all = readAll();
  const notif = all.find(n => n.id === notifId);
  if (!notif) return false;
  const sUserId = String(userId);
  if (!notif.readBy.includes(sUserId)) {
    notif.readBy.push(sUserId);
    notif.isRead = true;
  }
  writeAll(all);
  return true;
}

function markAllRead(userId) {
  const all = readAll();
  const sUserId = String(userId);
  all.forEach(n => {
    if (!n.recipientUserId || n.recipientUserId === sUserId) {
      if (!n.readBy.includes(sUserId)) n.readBy.push(sUserId);
      n.isRead = true;
    }
  });
  writeAll(all);
}

module.exports = { push, getUnread, getForUser, getRecent, markRead, markAllRead };
