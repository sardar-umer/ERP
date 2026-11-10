const mongoose = require('mongoose');

/**
 * Files attached by Pre-Audit when rejecting / returning a document.
 * Keyed by the audited document's _id so it works for every source module
 * (Purchase Orders, Cash Approvals, Vendor Bills, IPCs, Manual Salary, workflow documents, Pre Audit docs).
 */
const fileSchema = new mongoose.Schema({
  filename: { type: String, required: true },
  originalName: { type: String, required: true },
  path: { type: String, required: true },
  mimeType: { type: String },
  size: { type: Number }
}, { _id: true });

const auditActionAttachmentSchema = new mongoose.Schema({
  documentId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  documentType: { type: String, trim: true, default: '' },
  action: { type: String, enum: ['reject', 'return', 'observation'], default: 'reject' },
  comments: { type: String, trim: true, default: '' },
  files: { type: [fileSchema], default: [] },
  uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
}, { timestamps: true });

module.exports = mongoose.model('AuditActionAttachment', auditActionAttachmentSchema);
