const express = require('express');
const router  = express.Router();
const { authenticate } = require('../middleware/auth');
const notifStore = require('../services/notifications');

/**
 * GET /api/notifications
 * Returns unread notifications for the authenticated NGO/Volunteer user.
 * Query param: ?all=true  → returns recent 50 regardless of read state
 */
router.get('/', authenticate, (req, res) => {
  try {
    const userId = String(req.user.id);
    if (req.query.all === 'true') {
      const userNotifs = notifStore.getForUser(userId, 50, req.user.role);
      return res.json({ success: true, notifications: userNotifs });
    }
    const unread = notifStore.getUnread(userId, 30, req.user.role);
    return res.json({ success: true, notifications: unread, count: unread.length });
  } catch (err) {
    console.error('[notifications] GET error:', err);
    return res.status(500).json({ success: false, message: 'Could not fetch notifications.' });
  }
});

/**
 * POST /api/notifications/:id/read
 * Mark a single notification as read for the authenticated user.
 */
router.post('/:id/read', authenticate, (req, res) => {
  try {
    const ok = notifStore.markRead(req.params.id, String(req.user.id));
    return res.json({ success: true, marked: ok });
  } catch (err) {
    console.error('[notifications] mark-read error:', err);
    return res.status(500).json({ success: false, message: 'Could not mark notification as read.' });
  }
});
router.patch('/:id/read', authenticate, (req, res) => {
  try {
    const ok = notifStore.markRead(req.params.id, String(req.user.id));
    return res.json({ success: true, marked: ok });
  } catch (err) {
    console.error('[notifications] mark-read error:', err);
    return res.status(500).json({ success: false, message: 'Could not mark notification as read.' });
  }
});

/**
 * POST /api/notifications/read-all & PATCH /api/notifications/read-all
 * Mark ALL notifications as read for the authenticated user.
 */
router.post('/read-all', authenticate, (req, res) => {
  try {
    notifStore.markAllRead(String(req.user.id));
    return res.json({ success: true, message: 'All notifications marked as read.' });
  } catch (err) {
    console.error('[notifications] mark-all-read error:', err);
    return res.status(500).json({ success: false, message: 'Could not mark all as read.' });
  }
});
router.patch('/read-all', authenticate, (req, res) => {
  try {
    notifStore.markAllRead(String(req.user.id));
    return res.json({ success: true, message: 'All notifications marked as read.' });
  } catch (err) {
    console.error('[notifications] mark-all-read error:', err);
    return res.status(500).json({ success: false, message: 'Could not mark all as read.' });
  }
});

module.exports = router;
