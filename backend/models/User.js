const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { EMAIL_RE, EMAIL_MAX, NAME_MIN, NAME_MAX } = require('../utils/validation');

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, minlength: NAME_MIN, maxlength: NAME_MAX },
  email: {
    type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: EMAIL_MAX,
    match: [EMAIL_RE, 'Invalid email format'],
  },
  passwordHash: { type: String, required: true, select: false },
  role: { type: String, enum: ['admin', 'user'], default: 'user' },
  tokenVersion: { type: Number, default: 0, select: false }, // bumped on logout to revoke issued tokens
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  // soft delete: orthogonal to `status` (approval history). A deactivated user can no longer sign in or use a session,
  // but the account and everything it ever created stays in the database and stays attributed to it. Missing = active.
  active: { type: Boolean, default: true },
  approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  approvedAt: Date,
}, { timestamps: true });

userSchema.methods.comparePassword = function (plain) {
  return bcrypt.compare(plain, this.passwordHash);
};
userSchema.statics.hashPassword = (plain) => bcrypt.hash(plain, 10);

userSchema.index({ status: 1 }); // admin pending-signups query

module.exports = mongoose.model('User', userSchema);
