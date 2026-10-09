const express = require('express');
const controller = require('../controllers/chatController');
const { authenticate, authorizeRoles, requireActiveAccount } = require('../middleware/auth');
const { chatMessageValidation } = require('../middleware/validation');

const router = express.Router();
router.use(authenticate, authorizeRoles('ngo', 'restaurant', 'hotel', 'bakery', 'supermarket', 'catering', 'marriage_hall'), requireActiveAccount);
router.get('/', controller.listConversations);
router.get('/:donationId', controller.getConversation);
router.post('/:donationId/messages', chatMessageValidation, controller.sendMessage);

module.exports = router;
