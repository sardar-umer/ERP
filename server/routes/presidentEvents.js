const express = require('express');
const { body, validationResult, query } = require('express-validator');
const { asyncHandler } = require('../middleware/errorHandler');
const PresidentEvent = require('../models/general/PresidentEvent');

const router = express.Router();

const EVENT_TYPES = ['Official', 'Political', 'Ceremony', 'Social', 'Wedding', 'Dua', 'Other'];
const EVENT_STATUSES = ['Scheduled', 'Attended', 'Cancelled', 'Postponed'];

// @route   GET /api/president-events
router.get(
  '/',
  [
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 200 }),
    query('status').optional().isIn(EVENT_STATUSES),
    query('eventType').optional().isIn(EVENT_TYPES),
    query('search').optional().trim()
  ],
  asyncHandler(async (req, res) => {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 25;
    const skip = (page - 1) * limit;

    const filter = { isActive: true };

    if (req.query.status) filter.status = req.query.status;
    if (req.query.eventType) filter.eventType = req.query.eventType;

    if (req.query.search) {
      const search = String(req.query.search).trim();
      filter.$or = [
        { title: { $regex: search, $options: 'i' } },
        { eventNumber: { $regex: search, $options: 'i' } },
        { venue: { $regex: search, $options: 'i' } },
        { host: { $regex: search, $options: 'i' } },
        { representing: { $regex: search, $options: 'i' } }
      ];
    }

    if (req.query.fromDate || req.query.toDate) {
      filter.eventDate = {};
      if (req.query.fromDate) filter.eventDate.$gte = new Date(req.query.fromDate);
      if (req.query.toDate) {
        const to = new Date(req.query.toDate);
        to.setHours(23, 59, 59, 999);
        filter.eventDate.$lte = to;
      }
    }

    const [events, total] = await Promise.all([
      PresidentEvent.find(filter)
        .sort({ eventDate: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('createdBy', 'username email')
        .populate('updatedBy', 'username email')
        .lean(),
      PresidentEvent.countDocuments(filter)
    ]);

    res.json({
      success: true,
      data: {
        events,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit) || 1
        }
      }
    });
  })
);

// @route   GET /api/president-events/:id
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const event = await PresidentEvent.findOne({
      _id: req.params.id,
      isActive: true
    })
      .populate('createdBy', 'username email')
      .populate('updatedBy', 'username email');

    if (!event) {
      return res.status(404).json({ success: false, message: 'Event not found' });
    }

    res.json({ success: true, data: event });
  })
);

// @route   POST /api/president-events
router.post(
  '/',
  [
    body('title').trim().notEmpty().withMessage('Title is required'),
    body('eventDate').notEmpty().withMessage('Event date is required').isISO8601().toDate(),
    body('eventType').optional().isIn(EVENT_TYPES),
    body('status').optional().isIn(EVENT_STATUSES),
    body('venue').optional().trim(),
    body('startTime').optional().trim(),
    body('endTime').optional().trim(),
    body('host').optional().trim(),
    body('representing').optional().trim(),
    body('notes').optional().trim()
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });
    }

    const event = await PresidentEvent.create({
      title: req.body.title,
      eventDate: req.body.eventDate,
      startTime: req.body.startTime || '',
      endTime: req.body.endTime || '',
      venue: req.body.venue || '',
      eventType: req.body.eventType || 'Official',
      host: req.body.host || '',
      representing: req.body.representing || 'Sardar Tanveer Ilyas',
      notes: req.body.notes || '',
      status: req.body.status || 'Scheduled',
      createdBy: req.user?._id || req.user?.id,
      updatedBy: req.user?._id || req.user?.id
    });

    res.status(201).json({ success: true, data: event });
  })
);

// @route   PUT /api/president-events/:id
router.put(
  '/:id',
  [
    body('title').optional().trim().notEmpty().withMessage('Title cannot be empty'),
    body('eventDate').optional().isISO8601().toDate(),
    body('eventType').optional().isIn(EVENT_TYPES),
    body('venue').optional().trim(),
    body('status').optional().isIn(EVENT_STATUSES)
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });
    }

    const event = await PresidentEvent.findOne({
      _id: req.params.id,
      isActive: true
    });

    if (!event) {
      return res.status(404).json({ success: false, message: 'Event not found' });
    }

    const fields = [
      'title',
      'eventDate',
      'startTime',
      'endTime',
      'venue',
      'eventType',
      'host',
      'representing',
      'notes',
      'status'
    ];

    fields.forEach((field) => {
      if (req.body[field] !== undefined) {
        event[field] = req.body[field];
      }
    });

    event.updatedBy = req.user?._id || req.user?.id;
    await event.save();

    res.json({ success: true, data: event });
  })
);

// @route   DELETE /api/president-events/:id
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const event = await PresidentEvent.findOne({
      _id: req.params.id,
      isActive: true
    });

    if (!event) {
      return res.status(404).json({ success: false, message: 'Event not found' });
    }

    event.isActive = false;
    event.updatedBy = req.user?._id || req.user?.id;
    await event.save();

    res.json({ success: true, message: 'Event deleted' });
  })
);

module.exports = router;
