const express = require('express');
const analyticsController = require('../controllers/analyticsController');
const leaderboardController = require('../controllers/leaderboardController');
const certificateController = require('../controllers/certificateController');
const notificationController = require('../controllers/notificationController');
const { authenticate, authorizeRoles } = require('../middleware/auth');

const router = express.Router();

// Public Impact & Live Map
router.get('/analytics/public', analyticsController.getPublicAnalytics);
router.get('/analytics/map-data', authenticate, authorizeRoles('admin'), analyticsController.getMapData);

// Leaderboard
router.get('/leaderboard', leaderboardController.getLeaderboard);

// Digital Donation Certificate (for completed donations)
router.get('/certificate/:id', authenticate, certificateController.getDonationCertificate);

// User-authenticated endpoints
router.get('/rewards/my-points', authenticate, leaderboardController.getMyRewards);
router.get('/notifications', authenticate, notificationController.listForUser);
router.put('/notifications/:id/read', authenticate, notificationController.markRead);
router.patch('/notifications/:id/read', authenticate, notificationController.markRead);
router.patch('/notifications/read-all', authenticate, notificationController.markAllRead);

module.exports = router;
