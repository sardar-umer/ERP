const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  recipient: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  title: {
    type: String,
    required: true,
    trim: true
  },
  message: {
    type: String,
    required: true
  },
  type: {
    type: String,
    enum: ['info', 'success', 'warning', 'error', 'system', 'candidate_hired', 'employee_status_change', 'attendance_update', 'payroll_generated', 'loan_approved', 'leave_request', 'performance_review', 'training_assigned', 'chat_message'],
    default: 'info'
  },
  category: {
    type: String,
    enum: ['attendance', 'payroll', 'leave', 'approval', 'system', 'hiring', 'employee', 'finance', 'other'],
    default: 'other'
  },
  isRead: {
    type: Boolean,
    default: false
  },
  readAt: {
    type: Date
  },
  isArchived: {
    type: Boolean,
    default: false
  },
  archivedAt: {
    type: Date
  },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high', 'urgent'],
    default: 'medium'
  },
  actionUrl: {
    type: String // URL to navigate to when notification is clicked
  },
  actionText: {
    type: String // Text for the action button
  },
  metadata: {
    module: {
      type: String,
      enum: ['employees', 'hr', 'finance', 'crm', 'sales', 'procurement', 'audit', 'other'],
      default: 'other'
    },
    entityId: mongoose.Schema.Types.ObjectId, // Related entity ID
    entityType: String, // Type of related entity
    additionalData: mongoose.Schema.Types.Mixed // Any additional data
  },
  expiresAt: {
    type: Date // When the notification should expire
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true
});

// Index for better query performance
notificationSchema.index({ recipient: 1, isRead: 1 });
notificationSchema.index({ recipient: 1, createdAt: -1 });
notificationSchema.index({ recipient: 1, 'metadata.module': 1, isRead: 1 });
notificationSchema.index({ recipient: 1, type: 1, isRead: 1 });
notificationSchema.index({ recipient: 1, category: 1, isRead: 1 });

// Auto-expire notifications
notificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Static methods for common queries
notificationSchema.statics.getForUser = function(userId, options = {}) {
  const { type, status, limit = 50, skip = 0 } = options;
  
  let query = { recipient: userId };

  if (status === 'archived') {
    query.isArchived = true;
  } else {
    query.isArchived = { $ne: true };
  }

  if (type) {
    query.type = type;
  }
  
  if (status === 'unread') {
    query.isRead = false;
  } else if (status === 'read') {
    query.isRead = true;
  }
  
  return this.find(query)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .populate('recipient', 'firstName lastName email')
    .populate('createdBy', 'firstName lastName email');
};

notificationSchema.statics.getUnreadCount = function(userId) {
  return this.countDocuments({
    recipient: userId,
    isRead: false,
    isArchived: { $ne: true }
  });
};

notificationSchema.statics.getModuleCounts = function(userId) {
  return this.aggregate([
    {
      $match: {
        recipient: userId,
        isRead: false,
        isArchived: { $ne: true }
      }
    },
    {
      $group: {
        _id: '$metadata.module',
        count: { $sum: 1 }
      }
    },
    {
      $project: {
        module: '$_id',
        count: 1,
        _id: 0
      }
    }
  ]);
};

const toIdArray = (ids) => (Array.isArray(ids) ? ids : [ids]).filter(Boolean);

notificationSchema.statics.markAsRead = function(userId, notificationIds) {
  return this.updateMany(
    {
      _id: { $in: toIdArray(notificationIds) },
      recipient: userId,
      isRead: false
    },
    { 
      $set: { 
        isRead: true, 
        readAt: new Date() 
      } 
    }
  );
};

notificationSchema.statics.markAllAsRead = function(userId, filter = {}) {
  return this.updateMany(
    { ...filter, recipient: userId, isRead: false },
    { $set: { isRead: true, readAt: new Date() } }
  );
};

/** Archive = hide from the bell. Archiving also marks it read. */
notificationSchema.statics.markAsArchived = function(userId, notificationIds) {
  const now = new Date();
  return this.updateMany(
    { _id: { $in: toIdArray(notificationIds) }, recipient: userId, isArchived: { $ne: true } },
    [{
      $set: {
        isArchived: true,
        archivedAt: now,
        readAt: { $ifNull: ['$readAt', now] },
        isRead: true
      }
    }]
  );
};

notificationSchema.statics.archiveAllRead = function(userId) {
  return this.updateMany(
    { recipient: userId, isRead: true, isArchived: { $ne: true } },
    { $set: { isArchived: true, archivedAt: new Date() } }
  );
};

// Auto-categorize notifications based on type
notificationSchema.pre('save', function(next) {
  // Auto-categorize based on notification type
  if (this.type === 'candidate_hired' || this.type === 'employee_status_change') {
    this.metadata.module = 'employees';
    this.category = 'hiring';
  } else if (this.type === 'payroll_generated') {
    this.metadata.module = 'finance';
    this.category = 'payroll';
  } else if (this.type === 'attendance_update') {
    this.metadata.module = 'hr';
    this.category = 'attendance';
  } else if (this.type === 'leave_request') {
    this.metadata.module = 'hr';
    this.category = 'leave';
  } else if (this.type === 'loan_approved') {
    this.metadata.module = 'finance';
    this.category = 'other';
  } else if (this.type === 'performance_review' || this.type === 'training_assigned') {
    this.metadata.module = 'hr';
    this.category = 'other';
  }
  
  next();
});

module.exports = mongoose.model('Notification', notificationSchema);
