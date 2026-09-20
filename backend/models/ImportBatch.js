// Metadata about one stock-import commit. The uploaded file itself is never stored.
const mongoose = require('mongoose');

module.exports = mongoose.model('ImportBatch', new mongoose.Schema({
  filename: { type: String, maxlength: 255 },
  uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  uploadedAt: { type: Date, default: Date.now },
  rowCount: Number, createdCount: Number, skippedCount: Number, rejectedCount: Number,
}));
