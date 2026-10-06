const express = require('express');
const controller = require('../controllers/donationController');
const smartMatchController = require('../controllers/smartMatchController');
const { authenticate, authorizeBusiness, authorizeRoles, requireActiveAccount } = require('../middleware/auth');
const { uploadFoodImages } = require('../middleware/upload');
const { donationValidation } = require('../middleware/validation');

const router = express.Router();

router.get('/emergency', authenticate, authorizeRoles('ngo', 'admin'), requireActiveAccount, controller.getEmergencyDonations);
router.post('/emergency-broadcast/:id', authenticate, authorizeBusiness, requireActiveAccount, controller.emergencyBroadcast);
router.get('/smart-match/:id', authenticate, authorizeBusiness, requireActiveAccount, smartMatchController.getSmartMatch);
router.get('/available', authenticate, authorizeRoles('ngo', 'admin'), requireActiveAccount, controller.getAllDonations);
router.get('/search', authenticate, authorizeRoles('ngo', 'admin'), requireActiveAccount, controller.searchDonation);
router.get('/filter', authenticate, authorizeRoles('ngo', 'admin'), requireActiveAccount, controller.filterDonation);
router.get('/', authenticate, authorizeRoles('ngo', 'admin'), requireActiveAccount, controller.getAllDonations);
router.get('/:id', authenticate, requireActiveAccount, controller.getDonation);

router.post('/', authenticate, authorizeBusiness, uploadFoodImages, donationValidation, controller.createDonation);
router.put('/:id', authenticate, authorizeBusiness, uploadFoodImages, donationValidation, controller.updateDonation);
router.delete('/:id', authenticate, authorizeBusiness, controller.deleteDonation);

module.exports = router;
