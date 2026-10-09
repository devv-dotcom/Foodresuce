const express = require('express');
const controller = require('../controllers/partnerController');
const { authenticate, authorizeRoles, requireActiveAccount } = require('../middleware/auth');
const { uploadProofPhoto } = require('../middleware/upload');

const router = express.Router();

// Legacy partner API remains available to the supported NGO/Admin roles only.
router.use(authenticate, authorizeRoles('ngo', 'admin'), requireActiveAccount);

router.get('/dashboard', controller.getDashboard);
router.get('/notifications', controller.getNotifications);
router.patch('/notifications/read-all', controller.markAllNotificationsRead);
router.patch('/notifications/:id/read', controller.markNotificationRead);

router.get('/donations', controller.getDonations);
router.get('/donations/:id', controller.getDonationById);
router.post('/donations/:id/accept', controller.acceptDonation);

router.get('/assignments', controller.getAssignments);
router.get('/assignments/:id', controller.getAssignmentById);

router.post('/assignments/:id/start', controller.startNavigation);
router.post('/assignments/:id/arrive', controller.arrivePickup);
router.post('/assignments/:id/verify-pickup', controller.verifyPickupCode);
router.post('/assignments/:id/start-delivery', controller.startDelivery);
router.post('/assignments/:id/arrive-destination', controller.arriveDestination);
router.post('/assignments/:id/verify-delivery', controller.verifyDeliveryCode);
router.post('/assignments/:id/proof', uploadProofPhoto, controller.uploadProof);
router.post('/assignments/:id/complete', controller.completeAssignment);
router.post('/assignments/:id/cancel', controller.cancelAssignment);

router.get('/history', controller.getHistory);
router.get('/impact', controller.getImpact);
router.get('/profile', controller.getProfile);
router.put('/profile', controller.updateProfile);

module.exports = router;
