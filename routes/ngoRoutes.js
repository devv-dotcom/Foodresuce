const express = require('express');
const controller = require('../controllers/ngoController');
const { authenticate, authorizeRoles, requireActiveAccount } = require('../middleware/auth');
const { ngoRegistrationValidation, ngoProfileValidation, loginValidation } = require('../middleware/validation');

const router = express.Router();

router.post('/register', ngoRegistrationValidation, controller.registerNGO);
router.post('/login', loginValidation, controller.loginNGO);
router.use(authenticate, authorizeRoles('ngo'), requireActiveAccount);
router.get('/profile', controller.getProfile);
router.patch('/location', controller.updateLocation);
router.put('/profile', ngoProfileValidation, controller.updateProfile);
router.get('/donations', controller.browseDonations);
router.post('/accept/:id', controller.acceptDonation);
router.post('/confirm-delivery/:id', controller.confirmDelivery);
router.get('/history', controller.history);

module.exports = router;
