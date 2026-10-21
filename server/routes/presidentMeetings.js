const express = require('express');
const { body, validationResult, query } = require('express-validator');
const { asyncHandler } = require('../middleware/errorHandler');
const PresidentMeeting = require('../models/general/PresidentMeeting');

const router = express.Router();

const MEETING_TYPES = ['Board', 'Internal', 'External', 'Committee', 'Political', 'Other'];
const MEETING_VENUES = ['SGHQ', 'Annexe F8', 'Taj Site'];
const REQUEST_STATUSES = ['Requested', 'Rejected'];
const SCHEDULE_STATUSES = ['Scheduled', 'Completed', 'Cancelled', 'Postponed'];
const MEETING_STATUSES = [...REQUEST_STATUSES, ...SCHEDULE_STATUSES];

const normalizeAttendees = (attendees) => {
  if (!Array.isArray(attendees)) return [];
  return attendees
    .map((a) => ({
      name: String(a?.name || '').trim(),
      designation: String(a?.designation || '').trim()
    }))
    .filter((a) => a.name);
};

// @route   GET /api/president-meetings
// @desc    List President Secretariat meetings
// @access  Private
router.get(
  '/',
  [
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 200 }),
    query('status').optional().isIn(MEETING_STATUSES),
    query('bucket').optional().isIn(['requests', 'schedule']),
    query('meetingType').optional().isIn(MEETING_TYPES),
    query('search').optional().trim()
  ],
  asyncHandler(async (req, res) => {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 25;
    const skip = (page - 1) * limit;

    const filter = { isActive: true };

    if (req.query.status) {
      filter.status = req.query.status;
    } else if (req.query.bucket === 'requests') {
      filter.status = { $in: REQUEST_STATUSES };
    } else if (req.query.bucket === 'schedule') {
      filter.status = { $in: SCHEDULE_STATUSES };
    }

    if (req.query.meetingType) filter.meetingType = req.query.meetingType;

    if (req.query.search) {
      const search = String(req.query.search).trim();
      filter.$or = [
        { title: { $regex: search, $options: 'i' } },
        { meetingNumber: { $regex: search, $options: 'i' } },
        { venue: { $regex: search, $options: 'i' } },
        { chairperson: { $regex: search, $options: 'i' } }
      ];
    }

    if (req.query.fromDate || req.query.toDate) {
      filter.meetingDate = {};
      if (req.query.fromDate) filter.meetingDate.$gte = new Date(req.query.fromDate);
      if (req.query.toDate) {
        const to = new Date(req.query.toDate);
        to.setHours(23, 59, 59, 999);
        filter.meetingDate.$lte = to;
      }
    }

    const [meetings, total] = await Promise.all([
      PresidentMeeting.find(filter)
        .sort({ meetingDate: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('createdBy', 'username email')
        .populate('updatedBy', 'username email')
        .lean(),
      PresidentMeeting.countDocuments(filter)
    ]);

    res.json({
      success: true,
      data: {
        meetings,
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

// @route   GET /api/president-meetings/:id
// @desc    Get meeting by id
// @access  Private
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const meeting = await PresidentMeeting.findOne({
      _id: req.params.id,
      isActive: true
    })
      .populate('createdBy', 'username email')
      .populate('updatedBy', 'username email');

    if (!meeting) {
      return res.status(404).json({ success: false, message: 'Meeting not found' });
    }

    res.json({ success: true, data: meeting });
  })
);

// @route   POST /api/president-meetings
// @desc    Create meeting
// @access  Private
router.post(
  '/',
  [
    body('title').trim().notEmpty().withMessage('Title is required'),
    body('meetingDate').notEmpty().withMessage('Meeting date is required').isISO8601().toDate(),
    body('meetingType').optional().isIn(MEETING_TYPES),
    body('status').optional().isIn(MEETING_STATUSES),
    body('startTime').optional().trim(),
    body('endTime').optional().trim(),
    body('venue').optional().isIn(MEETING_VENUES),
    body('chairperson').optional().trim(),
    body('agenda').optional().trim(),
    body('minutes').optional().trim(),
    body('decisions').optional().trim()
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });
    }

    const meeting = await PresidentMeeting.create({
      title: req.body.title,
      meetingDate: req.body.meetingDate,
      startTime: req.body.startTime || '',
      endTime: req.body.endTime || '',
      venue: req.body.venue || 'SGHQ',
      meetingType: req.body.meetingType || 'Internal',
      chairperson: req.body.chairperson || 'Sardar Tanveer Ilyas',
      attendees: normalizeAttendees(req.body.attendees),
      agenda: req.body.agenda || '',
      minutes: req.body.minutes || '',
      decisions: req.body.decisions || '',
      // New entries are meeting requests until accepted into the schedule
      status: req.body.status && MEETING_STATUSES.includes(req.body.status)
        ? req.body.status
        : 'Requested',
      createdBy: req.user?._id || req.user?.id,
      updatedBy: req.user?._id || req.user?.id
    });

    res.status(201).json({ success: true, data: meeting });
  })
);

// @route   PUT /api/president-meetings/:id/accept
// @desc    Accept a meeting request → moves to Meeting Schedule (Scheduled)
// @access  Private
router.put(
  '/:id/accept',
  asyncHandler(async (req, res) => {
    const meeting = await PresidentMeeting.findOne({
      _id: req.params.id,
      isActive: true
    });

    if (!meeting) {
      return res.status(404).json({ success: false, message: 'Meeting not found' });
    }

    if (meeting.status !== 'Requested') {
      return res.status(400).json({
        success: false,
        message: 'Only requested meetings can be accepted'
      });
    }

    meeting.status = 'Scheduled';
    meeting.updatedBy = req.user?._id || req.user?.id;
    await meeting.save();

    res.json({ success: true, message: 'Meeting request accepted', data: meeting });
  })
);

// @route   PUT /api/president-meetings/:id/reject
// @desc    Reject a meeting request
// @access  Private
router.put(
  '/:id/reject',
  asyncHandler(async (req, res) => {
    const meeting = await PresidentMeeting.findOne({
      _id: req.params.id,
      isActive: true
    });

    if (!meeting) {
      return res.status(404).json({ success: false, message: 'Meeting not found' });
    }

    if (meeting.status !== 'Requested') {
      return res.status(400).json({
        success: false,
        message: 'Only requested meetings can be rejected'
      });
    }

    meeting.status = 'Rejected';
    meeting.updatedBy = req.user?._id || req.user?.id;
    await meeting.save();

    res.json({ success: true, message: 'Meeting request rejected', data: meeting });
  })
);

// @route   PUT /api/president-meetings/:id
// @desc    Update meeting
// @access  Private
router.put(
  '/:id',
  [
    body('title').optional().trim().notEmpty().withMessage('Title cannot be empty'),
    body('meetingDate').optional().isISO8601().toDate(),
    body('meetingType').optional().isIn(MEETING_TYPES),
    body('venue').optional().isIn(MEETING_VENUES),
    body('status').optional().isIn(MEETING_STATUSES)
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });
    }

    const meeting = await PresidentMeeting.findOne({
      _id: req.params.id,
      isActive: true
    });

    if (!meeting) {
      return res.status(404).json({ success: false, message: 'Meeting not found' });
    }

    const fields = [
      'title',
      'meetingDate',
      'startTime',
      'endTime',
      'venue',
      'meetingType',
      'chairperson',
      'agenda',
      'minutes',
      'decisions',
      'status'
    ];

    fields.forEach((field) => {
      if (req.body[field] !== undefined) {
        meeting[field] = req.body[field];
      }
    });

    if (req.body.attendees !== undefined) {
      meeting.attendees = normalizeAttendees(req.body.attendees);
    }

    meeting.updatedBy = req.user?._id || req.user?.id;
    await meeting.save();

    res.json({ success: true, data: meeting });
  })
);

// @route   DELETE /api/president-meetings/:id
// @desc    Soft-delete meeting
// @access  Private
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const meeting = await PresidentMeeting.findOne({
      _id: req.params.id,
      isActive: true
    });

    if (!meeting) {
      return res.status(404).json({ success: false, message: 'Meeting not found' });
    }

    meeting.isActive = false;
    meeting.updatedBy = req.user?._id || req.user?.id;
    await meeting.save();

    res.json({ success: true, message: 'Meeting deleted' });
  })
);

module.exports = router;
