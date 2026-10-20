'use strict';

const express = require('express');
const router = express.Router();
const {
  getNotifications,
  markRead,
  markAllRead,
  getUnreadCount,
} = require('../controllers/notificationController');
const { resolveSchool } = require('../middleware/schoolContext');
const { requireAdminAuth } = require('../middleware/auth');

// All notification routes require school context + admin authentication
router.use(resolveSchool);
router.use(requireAdminAuth);

// GET /api/notifications — paginated list (accepts ?page, ?limit, ?unreadOnly)
router.get('/', getNotifications);

// GET /api/notifications/unread-count — fast count for badge display
// Registered before /:id patterns to avoid route shadowing
router.get('/unread-count', getUnreadCount);

// PATCH /api/notifications/read — mark specific notifications as read
router.patch('/read', markRead);

// POST /api/notifications/read-all — mark all as read
router.post('/read-all', markAllRead);

module.exports = router;
