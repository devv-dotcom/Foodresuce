const express = require('express');
const controller = require('../controllers/assignmentController');
const { authenticate, authorizeRoles, requireActiveAccount } = require('../middleware/auth');
const { uploadProofPhoto } = require('../middleware/upload');

const router = express.Router();

// Assignments are limited to the supported operational roles.
router.use(authenticate, authorizeRoles('ngo', 'admin'), requireActiveAccount);

router.get('/', controller.getAssignments);
router.get('/:id', controller.getAssignmentById);

router.post('/:id/start', controller.startPickup);
router.post('/:id/pickup', controller.confirmPickup);
router.post('/:id/delivery', controller.startDelivery);
router.post('/:id/complete', controller.completeAssignment);
router.post('/:id/cancel', controller.cancelAssignment);

router.post('/:id/proof', uploadProofPhoto, controller.uploadProof);
router.get('/:id/proof', controller.getProofs);

module.exports = router;
