const Notification = require('../models/Notification');
const ActivityLog = require('../models/ActivityLog');
const userNotifications = require('../services/userNotifications');

const page = query => ({ limit: Math.min(Math.max(Number(query.limit) || 20, 1), 100), offset: Math.max(Number(query.offset) || 0, 0) });
exports.list = async (req, res, next) => { try { const { limit, offset } = page(req.query); return res.json({ success: true, notifications: await Notification.list(limit, offset) }); } catch (error) { next(error); } };
exports.listForUser = async (req, res, next) => {
  try {
    const notifications = await userNotifications.listForUser(req.user.id, req.user.role);
    const unreadCount = notifications.filter(notification => !notification.is_read).length;
    return res.json({ success: true, notifications, unreadCount });
  } catch (error) { next(error); }
};
exports.create = async (req, res, next) => {
  try {
    const id = await Notification.create(req.admin.admin_id, req.body);
    await ActivityLog.create({ actorUserId: req.user.id, action: 'notification_created', entityType: 'notification', entityId: id, details: { targetRole: req.body.targetRole || 'all' }, ipAddress: req.ip });
    return res.status(201).json({ success: true, message: 'Notification created successfully.', notificationId: id });
  } catch (error) { next(error); }
};
exports.remove = async (req, res, next) => {
  try {
    if (!(await Notification.remove(req.params.id))) return res.status(404).json({ success: false, message: 'Notification not found.' });
    await ActivityLog.create({ actorUserId: req.user.id, action: 'notification_deleted', entityType: 'notification', entityId: Number(req.params.id), ipAddress: req.ip });
    return res.json({ success: true, message: 'Notification deleted successfully.' });
  } catch (error) { next(error); }
};
exports.markRead = async (req, res, next) => {
  try {
    if (!(await userNotifications.markRead(req.params.id, req.user.id, req.user.role))) return res.status(404).json({ success: false, message: 'Notification not found.' });
    return res.json({ success: true, message: 'Notification marked as read.' });
  } catch (error) { next(error); }
};
exports.markAllRead = async (req, res, next) => {
  try {
    await userNotifications.markAllRead(req.user.id, req.user.role);
    return res.json({ success: true, message: 'All notifications marked as read.' });
  } catch (error) { next(error); }
};
