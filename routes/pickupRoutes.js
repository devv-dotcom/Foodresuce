const express = require('express');
const controller = require('../controllers/pickupController');
const { authenticate, authorizeRoles, requireActiveAccount } = require('../middleware/auth');
const { uploadDeliveryProof } = require('../middleware/upload');
const { deliveryProofValidation } = require('../middleware/validation');

const router = express.Router();

// Live tracking is private because its response contains contact information.
router.get('/track/:id', authenticate, requireActiveAccount, controller.trackPickup);

// Volunteer-protected operations
router.use(authenticate, authorizeRoles('volunteer'), requireActiveAccount);
router.get('/', controller.getPickupRequests);
router.get('/:id', controller.getPickupById);
router.post('/accept/:id', controller.acceptPickup);
router.put('/start/:id', controller.startPickup);
router.put('/collect/:id', controller.collectFood);
router.put('/deliver/:id', controller.deliverFood);
router.put('/complete/:id', controller.completePickup);
router.put('/location/:id', controller.updateLocation);
router.post('/proof/:id', uploadDeliveryProof, deliveryProofValidation, controller.uploadDeliveryProof);

module.exports = router;
