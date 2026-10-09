'use strict';

const Notification = require('../models/Notification');
const notificationStore = require('./notifications');

async function listForUser(userId, role) {
  const [databaseNotifications, operationalNotifications] = await Promise.all([
    Notification.listForUser(userId, role),
    Promise.resolve(notificationStore.getForUser(String(userId), 50))
  ]);

  const normalizedDatabase = databaseNotifications.map(notification => ({
    ...notification,
    is_read: Boolean(notification.is_read),
    message: notification.message || ''
  }));
  const normalizedOperational = operationalNotifications.map(notification => ({
    ...notification,
    created_at: notification.created_at || notification.createdAt,
    is_read: Boolean(notification.is_read ?? notification.isRead),
    message: notification.message || notification.body || ''
  }));

  return [...normalizedDatabase, ...normalizedOperational]
    .sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime())
    .slice(0, 50);
}

async function markRead(id, userId, role) {
  if (String(id).startsWith('ntf_')) return notificationStore.markRead(id, String(userId));
  return Notification.markRead(id, userId, role);
}

async function markAllRead(userId, role) {
  const [databaseCount] = await Promise.all([
    Notification.markAllRead(userId, role),
    Promise.resolve(notificationStore.markAllRead(String(userId)))
  ]);
  return databaseCount;
}

module.exports = { listForUser, markRead, markAllRead };
