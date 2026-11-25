const express = require('express');
const router = express.Router();
const { authMiddleware, authorize } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const NotificationService = require('../services/notificationService');
const Notification = require('../models/hr/Notification');

// @route   GET /api/notifications
// @desc    Get notifications for the authenticated user
// @access  Private
router.get('/', authMiddleware, asyncHandler(async (req, res) => {
  const { 
    status = 'unread', 
    type, 
    page = 1, 
    limit = 20,
    sort = 'createdAt'
  } = req.query;

  const options = {
    status,
    type,
    limit: parseInt(limit),
    skip: (parseInt(page) - 1) * parseInt(limit),
    sort: { [sort]: -1 }
  };

  const notifications = await NotificationService.getUserNotifications(req.user._id, options);
  const unreadCount = await NotificationService.getUnreadCount(req.user._id);

  res.json({
    success: true,
    data: notifications,
    pagination: {
      page: parseInt(page),
      limit: parseInt(limit),
      total: notifications.length,
      unreadCount
    }
  });
}));

// @route   GET /api/notifications/unread-count
// @desc    Get unread notification count for the authenticated user
// @access  Private
router.get('/unread-count', authMiddleware, asyncHandler(async (req, res) => {
  const count = await NotificationService.getUnreadCount(req.user._id);
  
  res.json({
    success: true,
    data: { unreadCount: count }
  });
}));

// @route   POST /api/notifications/:id/read
// @desc    Mark a notification as read
// @access  Private
router.post('/:id/read', authMiddleware, asyncHandler(async (req, res) => {
  const { id } = req.params;
  
  const result = await NotificationService.markAsRead(id, req.user._id);
  
  if (result.modifiedCount === 0) {
    return res.status(404).json({
      success: false,
      message: 'Notification not found or already read'
    });
  }

  res.json({
    success: true,
    message: 'Notification marked as read'
  });
}));

// @route   POST /api/notifications/:id/archive
// @desc    Mark a notification as archived
// @access  Private
router.post('/:id/archive', authMiddleware, asyncHandler(async (req, res) => {
  const { id } = req.params;
  
  const result = await NotificationService.markAsArchived(id, req.user._id);
  
  if (result.modifiedCount === 0) {
    return res.status(404).json({
      success: false,
      message: 'Notification not found or already archived'
    });
  }

  res.json({
    success: true,
    message: 'Notification archived'
  });
}));

// @route   POST /api/notifications/read-all
// @desc    Mark all notifications as read for the authenticated user
// @access  Private
router.post('/read-all', authMiddleware, asyncHandler(async (req, res) => {
  const result = await Notification.markAllAsRead(req.user._id);

  res.json({
    success: true,
    message: `${result.modifiedCount} notifications marked as read`,
    modifiedCount: result.modifiedCount
  });
}));

// @route   POST /api/notifications/archive-all
// @desc    Archive all read notifications for the authenticated user
// @access  Private
router.post('/archive-all', authMiddleware, asyncHandler(async (req, res) => {
  const result = await Notification.archiveAllRead(req.user._id);

  res.json({
    success: true,
    message: `${result.modifiedCount} notifications archived`,
    modifiedCount: result.modifiedCount
  });
}));

// @route   DELETE /api/notifications/:id
// @desc    Delete a notification (only for the authenticated user)
// @access  Private
router.delete('/:id', authMiddleware, asyncHandler(async (req, res) => {
  const { id } = req.params;

  // Each notification row belongs to exactly one recipient, so deleting it only affects this user
  const result = await Notification.deleteOne({ _id: id, recipient: req.user._id });

  if (result.deletedCount === 0) {
    return res.status(404).json({
      success: false,
      message: 'Notification not found or already removed'
    });
  }

  res.json({
    success: true,
    message: 'Notification removed'
  });
}));

// @route   GET /api/notifications/stats
// @desc    Get notification statistics for the authenticated user
// @access  Private
router.get('/stats', authMiddleware, asyncHandler(async (req, res) => {
  const recipient = req.user._id;
  const [unreadCount, readCount, archivedCount, typeStats, priorityStats] = await Promise.all([
    Notification.countDocuments({ recipient, isRead: false, isArchived: { $ne: true } }),
    Notification.countDocuments({ recipient, isRead: true, isArchived: { $ne: true } }),
    Notification.countDocuments({ recipient, isArchived: true }),
    Notification.aggregate([
      { $match: { recipient } },
      { $group: { _id: '$type', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]),
    Notification.aggregate([
      { $match: { recipient, isRead: false, isArchived: { $ne: true } } },
      { $group: { _id: '$priority', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ])
  ]);

  res.json({
    success: true,
    data: {
      total: unreadCount + readCount + archivedCount,
      unread: unreadCount,
      read: readCount,
      archived: archivedCount,
      byType: typeStats,
      byPriority: priorityStats
    }
  });
}));

// @route   GET /api/notifications/admin/all
// @desc    Get all notifications (Admin/HR only)
// @access  Private (Admin/HR)
router.get('/admin/all', authorize('super_admin', 'admin', 'hr_manager'), asyncHandler(async (req, res) => {
  const { 
    page = 1, 
    limit = 50,
    status,
    type,
    priority,
    sort = 'createdAt'
  } = req.query;

  const query = {};

  if (status === 'unread') query.isRead = false;
  else if (status === 'read') query.isRead = true;
  else if (status === 'archived') query.isArchived = true;
  if (type) query.type = type;
  if (priority) query.priority = priority;

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));
  const [docs, totalDocs] = await Promise.all([
    Notification.find(query)
      .sort({ [sort]: -1 })
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum)
      .populate('recipient', 'firstName lastName email profileImage')
      .populate('createdBy', 'firstName lastName email profileImage')
      .lean(),
    Notification.countDocuments(query)
  ]);
  const totalPages = Math.max(1, Math.ceil(totalDocs / limitNum));

  res.json({
    success: true,
    data: docs,
    pagination: {
      page: pageNum,
      limit: limitNum,
      totalPages,
      totalDocs,
      hasNextPage: pageNum < totalPages,
      hasPrevPage: pageNum > 1
    }
  });
}));

// @route   DELETE /api/notifications/admin/:id
// @desc    Delete a notification completely (Admin/HR only)
// @access  Private (Admin/HR)
router.delete('/admin/:id', authorize('super_admin', 'admin', 'hr_manager'), asyncHandler(async (req, res) => {
  const { id } = req.params;
  
  const notification = await Notification.findByIdAndDelete(id);
  
  if (!notification) {
    return res.status(404).json({
      success: false,
      message: 'Notification not found'
    });
  }

  res.json({
    success: true,
    message: 'Notification deleted successfully'
  });
}));

// @route   POST /api/notifications/admin/cleanup
// @desc    Clean up expired notifications (Admin/HR only)
// @access  Private (Admin/HR)
router.post('/admin/cleanup', authorize('super_admin', 'admin', 'hr_manager'), asyncHandler(async (req, res) => {
  const result = await NotificationService.deleteExpiredNotifications();
  
  res.json({
    success: true,
    message: `Cleanup completed. ${result.deletedCount} expired notifications deleted.`,
    deletedCount: result.deletedCount
  });
}));

// @route   POST /api/notifications/mark-candidate-hired-read
// @desc    Mark all candidate_hired notifications as read for the authenticated user
// @access  Private
router.post('/mark-candidate-hired-read', authMiddleware, asyncHandler(async (req, res) => {
  const result = await Notification.markAllAsRead(req.user._id, { type: 'candidate_hired' });

  res.json({
    success: true,
    message: `${result.modifiedCount} candidate hired notifications marked as read`,
    data: { readCount: result.modifiedCount }
  });
}));

// @route   GET /api/notifications/module-counts
// @desc    Get module-specific notification counts for the authenticated user
// @access  Private
router.get('/module-counts', authMiddleware, asyncHandler(async (req, res) => {
  try {
    const userId = req.user._id;
    
    // Get counts for each module using aggregation for better performance
    const moduleCounts = await Notification.getModuleCounts(userId);
    
    // Convert to object format
    const counts = {};
    moduleCounts.forEach(item => {
      counts[item.module || 'other'] = item.count;
    });

    // Ensure all modules have a count (even if 0)
    const allModules = ['employees', 'hr', 'finance', 'crm', 'sales', 'procurement'];
    allModules.forEach(module => {
      if (!counts[module]) {
        counts[module] = 0;
      }
    });

    res.json({
      success: true,
      data: counts
    });
  } catch (error) {
    console.error('Error getting module counts:', error);
    res.status(500).json({
      success: false,
      message: 'Error getting module counts'
    });
  }
}));

// @route   PUT /api/notifications/mark-read
// @desc    Mark multiple notifications as read (optimized batch operation)
// @access  Private
router.put('/mark-read', authMiddleware, asyncHandler(async (req, res) => {
  const { notificationIds } = req.body;
  const userId = req.user._id;

  if (!notificationIds || !Array.isArray(notificationIds)) {
    return res.status(400).json({
      success: false,
      message: 'Notification IDs array is required'
    });
  }

  try {
    // Mark notifications as read
    const result = await Notification.markAsRead(userId, notificationIds);
    
    res.json({
      success: true,
      message: `${result.modifiedCount} notifications marked as read`,
      data: {
        modifiedCount: result.modifiedCount
      }
    });
  } catch (error) {
    console.error('Error marking notifications as read:', error);
    res.status(500).json({
      success: false,
      message: 'Error marking notifications as read'
    });
  }
}));

module.exports = router;
