const mongoose = require('mongoose');

const announcementSchema = new mongoose.Schema(
  {
    enabled: { type: Boolean, default: false },
    text: { type: String, trim: true, default: '' },
    // Pixels per second (frontend can interpret); keep simple numeric
    speed: { type: Number, default: 80, min: 20, max: 300 }
  },
  { _id: false }
);

const companyProfileSchema = new mongoose.Schema({
  name:        { type: String, default: 'SGC International' },
  legalName:   { type: String, default: '' },
  ntn:         { type: String, default: '' },   // FBR NTN
  strn:        { type: String, default: '' },   // Sales Tax Registration Number
  address:     { type: String, default: '' },
  city:        { type: String, default: 'Islamabad' },
  country:     { type: String, default: 'Pakistan' },
  phone:       { type: String, default: '' },
  email:       { type: String, default: 'finance@sgc.international' },
  website:     { type: String, default: 'www.sgc.international' },
  logoUrl:     { type: String, default: '' },
  currency:    { type: String, default: 'PKR' },
  bankName:    { type: String, default: '' },
  bankAccount: { type: String, default: '' },
  bankBranchCode: { type: String, default: '' },
  bankBranchName: { type: String, default: '' },
  bankIBAN:    { type: String, default: '' },
  salaryLetterRefPrefix: { type: String, default: '' },
  invoiceFooter: { type: String, default: 'Thank you for your business.' },
}, { _id: false });

const systemSettingsSchema = new mongoose.Schema(
  {
    key:            { type: String, required: true, unique: true, default: 'default' },
    announcement:   { type: announcementSchema, default: () => ({}) },
    companyProfile: { type: companyProfileSchema, default: () => ({}) },
    /**
     * Emails allowed to receive mobile chat / WhatsApp approval notifications.
     * Assignees not on this list are skipped (pilot / rollout control).
     */
    approvalMobileNotifyEmails: {
      type: [String],
      default: () => ([
        'developer@tovus.net',
        'ceo@sgc.com',
        'fahadfarid@tovus.net',
        'muhammadnawaz@tovus.net',
        'hamzatanveer@tovus.net',
        'usmantanveer@tovus.net'
      ])
    },
    /**
     * Cost center go-live: payable documents whose chain starts on/after this date must carry a cost center.
     * Null = not live yet (nothing is blocked). See utils/costCenterPolicy.
     */
    costCenterMandatoryFrom: { type: Date, default: null },
    costCenterMandatoryUpdatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    costCenterMandatoryUpdatedAt: { type: Date, default: null },
    updatedBy:      { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  },
  { timestamps: true }
);

systemSettingsSchema.statics.getSingleton = async function () {
  let doc = await this.findOne({ key: 'default' });
  if (!doc) {
    doc = await this.create({ key: 'default' });
  }
  return doc;
};

module.exports = mongoose.model('SystemSettings', systemSettingsSchema);

