const mongoose = require('mongoose');
const { ObjectId } = mongoose.Schema.Types;

const movementSchema = new mongoose.Schema({
  material: { type: ObjectId, ref: 'Material', required: true },
  type: { type: String, enum: ['IN', 'OUT', 'RETURN'], required: true },
  quantity: { type: Number, required: true, min: 0.0001 },
  rate: { type: Number, required: true, min: 0 },          // effective/display rate
  enteredRate: { type: Number, min: 0, default: null },    // IN only: rate actually paid
  amount: { type: Number, required: true },
  balanceAfter: { type: Number, required: true },
  exceededStock: { type: Boolean, default: false },
  movementDate: { type: Date, default: Date.now },
  note: String,
  createdBy: { type: ObjectId, ref: 'User' },
  isEdited: { type: Boolean, default: false },
  lastEditedBy: { type: ObjectId, ref: 'User' },
  lastEditedAt: Date,
}, { timestamps: true });

// ordering used by the Phase 5 recalculation engine
movementSchema.index({ material: 1, movementDate: 1, createdAt: 1 });

module.exports = mongoose.model('Movement', movementSchema);
