const express = require('express');
const controller = require('../controllers/ngoController');
const { authenticate, authorizeRoles, requireActiveAccount } = require('../middleware/auth');
const { ngoRegistrationValidation, ngoProfileValidation, loginValidation } = require('../middleware/validation');
const { uploadProofPhoto } = require('../middleware/upload');

const router = express.Router();

router.post('/register', ngoRegistrationValidation, controller.registerNGO);
router.post('/login', loginValidation, controller.loginNGO);
router.use(authenticate, authorizeRoles('ngo'), requireActiveAccount);
router.get('/profile', controller.getProfile);
router.patch('/location', controller.updateLocation);
router.put('/profile', ngoProfileValidation, controller.updateProfile);
router.get('/donations', controller.browseDonations);
router.get('/recommendations', controller.recommendedDonations);
router.post('/accept/:id', controller.acceptDonation);
router.post('/confirm-delivery/:id', controller.confirmDelivery);
router.patch('/donations/:id/pickup/schedule', controller.schedulePickup);
router.post('/donations/:id/pickup/start', controller.startPickup);
router.post('/donations/:id/pickup/collect', controller.collectFood);
router.post('/donations/:id/distribution', uploadProofPhoto, controller.recordDistribution);
router.post('/donations/:id/complete', controller.completeRescue);
router.get('/history', controller.history);

module.exports = router;
