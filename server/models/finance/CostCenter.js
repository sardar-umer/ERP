const mongoose = require('mongoose');

const costCenterSchema = new mongoose.Schema({
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'PlacementCompany',
    required: [true, 'Company ID is required'],
    index: true
  },
  name: {
    type: String,
    required: [true, 'Cost Center name is required'],
    trim: true
  },
  /** Optional; the database keeps a unique (companyId, code) index, so linked store cost centers bring their code */
  code: {
    type: String,
    trim: true
  },
  description: {
    type: String,
    trim: true,
    maxlength: [500, 'Description cannot exceed 500 characters']
  },
  isActive: {
    type: Boolean,
    default: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});



module.exports = mongoose.model('FinanceCostCenter', costCenterSchema);
