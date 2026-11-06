const mongoose = require('mongoose');

/**
 * Extra Sector / Block names added from the Project form ("+ Add new sector").
 * The built-in Taj Residencia sectors stay in the client; these are added on top, for every project type.
 */
const projectSectorSchema = new mongoose.Schema(
  {
    name: { type: String, required: [true, 'Sector name is required'], trim: true, maxlength: 100 },
    nameKey: { type: String, required: true, unique: true }, // lower-cased name, blocks duplicates
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  },
  { timestamps: true }
);

module.exports = mongoose.model('ProjectSector', projectSectorSchema);
