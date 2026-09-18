const mongoose = require('mongoose');
const { ObjectId } = mongoose.Schema.Types;
const num = { type: Number, min: 0, default: 0 };
const signedNum = { type: Number, default: 0 }; // stock may go negative (OUT beyond available)

const materialSchema = new mongoose.Schema({
  materialId: { type: String, required: true, unique: true, uppercase: true, trim: true, maxlength: 50 },
  description: { type: String, required: true, trim: true, maxlength: 200 },
  unit: { type: String, required: true, trim: true, maxlength: 30 },
  openingRate: num,
  openingQuantity: num,
  currentRate: num,      // system-maintained
  currentQuantity: signedNum, // system-maintained
  minimumQuantity: num,
  isActive: { type: Boolean, default: true },
  // cross-process lock (see utils/costing.js withLock); never loaded or serialised
  lockedUntil: { type: Date, select: false },
  lockToken: { type: String, select: false },
  createdBy: { type: ObjectId, ref: 'User' },
}, { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } });

materialSchema.virtual('stockValue').get(function () {
  return this.currentQuantity * this.currentRate;
});
materialSchema.virtual('status').get(function () {
  if (this.currentQuantity <= 0) return 'OUT_OF_STOCK';
  if (this.currentQuantity <= this.minimumQuantity) return 'LOW_STOCK';
  return 'AVAILABLE';
});

module.exports = mongoose.model('Material', materialSchema);
