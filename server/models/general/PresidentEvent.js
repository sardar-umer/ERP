const mongoose = require('mongoose');

const presidentEventSchema = new mongoose.Schema(
  {
    eventNumber: {
      type: String,
      unique: true,
      trim: true,
      uppercase: true
    },
    title: {
      type: String,
      required: [true, 'Event title is required'],
      trim: true,
      maxlength: [250, 'Title cannot exceed 250 characters']
    },
    eventDate: {
      type: Date,
      required: [true, 'Event date is required'],
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
      trim: true,
      maxlength: [250, 'Venue cannot exceed 250 characters'],
      default: ''
    },
    eventType: {
      type: String,
      enum: ['Official', 'Political', 'Ceremony', 'Social', 'Wedding', 'Dua', 'Other'],
      default: 'Official'
    },
    host: {
      type: String,
      trim: true,
      maxlength: [200, 'Host cannot exceed 200 characters'],
      default: ''
    },
    representing: {
      type: String,
      trim: true,
      maxlength: [150, 'Representing cannot exceed 150 characters'],
      default: 'Sardar Tanveer Ilyas'
    },
    notes: {
      type: String,
      trim: true,
      maxlength: [5000, 'Notes cannot exceed 5000 characters'],
      default: ''
    },
    status: {
      type: String,
      enum: ['Scheduled', 'Attended', 'Cancelled', 'Postponed'],
      default: 'Scheduled',
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

presidentEventSchema.index({ title: 'text', eventNumber: 'text', host: 'text', venue: 'text' });

presidentEventSchema.pre('save', async function generateEventNumber(next) {
  if (!this.isNew || this.eventNumber) {
    return next();
  }

  try {
    const year = new Date().getFullYear();
    const prefix = `PSE-${year}-`;
    const latest = await this.constructor
      .findOne({ eventNumber: new RegExp(`^${prefix}`) })
      .sort({ eventNumber: -1 })
      .select('eventNumber')
      .lean();

    let sequence = 1;
    if (latest?.eventNumber) {
      const parts = latest.eventNumber.split('-');
      const last = parseInt(parts[parts.length - 1], 10);
      if (!Number.isNaN(last)) sequence = last + 1;
    }

    this.eventNumber = `${prefix}${String(sequence).padStart(4, '0')}`;
    next();
  } catch (err) {
    next(err);
  }
});

module.exports = mongoose.model('PresidentEvent', presidentEventSchema);
