const express = require('express');
const controller = require('../controllers/notificationController');
const { authenticate } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate);
router.get('/', controller.listForUser);
router.patch('/read-all', controller.markAllRead);
router.post('/read-all', controller.markAllRead);
router.put('/:id/read', controller.markRead);
router.patch('/:id/read', controller.markRead);
router.post('/:id/read', controller.markRead);

module.exports = router;
