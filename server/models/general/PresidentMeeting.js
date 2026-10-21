const mongoose = require('mongoose');

const attendeeSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 150
    },
    designation: {
      type: String,
      trim: true,
      maxlength: 150,
      default: ''
    }
  },
  { _id: false }
);

const presidentMeetingSchema = new mongoose.Schema(
  {
    meetingNumber: {
      type: String,
      unique: true,
      trim: true,
      uppercase: true
    },
    title: {
      type: String,
      required: [true, 'Meeting title is required'],
      trim: true,
      maxlength: [250, 'Title cannot exceed 250 characters']
    },
    description: {
      type: String,
      trim: true,
      maxlength: [2000, 'Description cannot exceed 2000 characters'],
      default: ''
    },
    meetingDate: {
      type: Date,
      required: [true, 'Meeting date is required'],
      index: true
    },
    startTime: {
      type: String,
      trim: true,
      default: ''
    },
    endTime: {
      type: String,
      trim: true,
      default: ''
    },
    venue: {
      type: String,
      enum: ['SGHQ', 'Annexe F8', 'Taj Site'],
      default: 'SGHQ'
    },
    meetingType: {
      type: String,
      enum: ['Board', 'Internal', 'External', 'Committee', 'Political', 'Other'],
      default: 'Internal'
    },
    chairperson: {
      type: String,
      trim: true,
      maxlength: [150, 'Chairperson cannot exceed 150 characters'],
      default: 'Sardar Tanveer Ilyas'
    },
    attendees: {
      type: [attendeeSchema],
      default: []
    },
    agenda: {
      type: String,
      trim: true,
      maxlength: [5000, 'Agenda cannot exceed 5000 characters'],
      default: ''
    },
    minutes: {
      type: String,
      trim: true,
      maxlength: [10000, 'Minutes cannot exceed 10000 characters'],
      default: ''
    },
    decisions: {
      type: String,
      trim: true,
      maxlength: [5000, 'Decisions cannot exceed 5000 characters'],
      default: ''
    },
    status: {
      type: String,
      // Requested/Rejected = Meeting Request tab; Scheduled+ = Meeting Schedule tab
      enum: ['Requested', 'Rejected', 'Scheduled', 'Completed', 'Cancelled', 'Postponed'],
      default: 'Requested',
      index: true
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  },
  {
    timestamps: true
  }
);

presidentMeetingSchema.index({ title: 'text', meetingNumber: 'text', venue: 'text' });

presidentMeetingSchema.pre('save', async function generateMeetingNumber(next) {
  if (!this.isNew || this.meetingNumber) {
    return next();
  }

  try {
    const year = new Date().getFullYear();
    const prefix = `PSM-${year}-`;
    const latest = await this.constructor
      .findOne({ meetingNumber: new RegExp(`^${prefix}`) })
      .sort({ meetingNumber: -1 })
      .select('meetingNumber')
      .lean();

    let sequence = 1;
    if (latest?.meetingNumber) {
      const parts = latest.meetingNumber.split('-');
      const last = parseInt(parts[parts.length - 1], 10);
      if (!Number.isNaN(last)) sequence = last + 1;
    }

    this.meetingNumber = `${prefix}${String(sequence).padStart(4, '0')}`;
    next();
  } catch (err) {
    next(err);
  }
});

module.exports = mongoose.model('PresidentMeeting', presidentMeetingSchema);
