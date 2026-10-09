const express = require('express');
const admin = require('../controllers/adminController');
const dashboard = require('../controllers/dashboardController');
const report = require('../controllers/reportController');
const analytics = require('../controllers/analyticsController');
const notification = require('../controllers/notificationController');
const category = require('../controllers/categoryController');
const { authenticate, authorizeRoles } = require('../middleware/auth');
const { requireActiveAdmin } = require('../middleware/adminAuth');
const { adminLoginValidation, donationStatusValidation, notificationValidation, contactReplyValidation, websiteSettingValidation } = require('../middleware/validation');
const { rateLimit } = require('../middleware/rateLimit');

const router = express.Router();
router.post('/login', rateLimit(), adminLoginValidation, admin.login);
router.use(authenticate, authorizeRoles('admin'), requireActiveAdmin);
router.get('/dashboard', dashboard.getDashboard);
router.get('/categories', category.list);

router.get('/businesses', admin.listBusinesses);
router.put('/business/approve/:id', admin.approveBusiness);
router.put('/business/reject/:id', admin.rejectBusiness);
router.put('/business/suspend/:id', admin.suspendBusiness);
router.put('/business/activate/:id', admin.activateBusiness);
router.delete('/business/:id', admin.deleteBusiness);

router.get('/ngos', admin.listNgos);
router.get('/volunteers', admin.listVolunteers);
router.put('/ngo/approve/:id', admin.approveNgo);
router.put('/ngo/reject/:id', admin.rejectNgo);
router.put('/ngo/suspend/:id', admin.suspendNgo);
router.delete('/ngo/:id', admin.deleteNgo);

router.get('/donations', admin.listDonations);
router.put('/donation/status/:id', donationStatusValidation, admin.updateDonationStatus);
router.delete('/donation/:id', admin.deleteDonation);
router.put('/donation/restore/:id', admin.restoreDonation);

router.get('/reports', report.getReports);
router.get('/analytics', analytics.getAnalytics);
router.get('/notifications', notification.list);
router.post('/notifications', notificationValidation, notification.create);
router.delete('/notifications/:id', notification.remove);
router.put('/notifications/:id/read', notification.markRead);
router.get('/activity-logs', admin.listActivityLogs);
router.get('/contact-messages', admin.listContactMessages);
router.put('/contact-message/:id/read', admin.markContactRead);
router.put('/contact-message/:id/reply', contactReplyValidation, admin.replyToContact);
router.delete('/contact-message/:id', admin.deleteContactMessage);
router.get('/reviews', admin.listReviews);
router.put('/review/:id/approve', admin.approveReview);
router.put('/review/:id/hide', admin.hideReview);
router.delete('/review/:id', admin.deleteReview);
router.get('/settings', admin.getSettings);
router.put('/settings', websiteSettingValidation, admin.updateSetting);
module.exports = router;
