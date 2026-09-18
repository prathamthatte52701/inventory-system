const mongoose = require('mongoose');

// One document per email that has recently tried to log in (also for emails that do not exist, so a lockout
// reveals nothing about which accounts are real). Stored in MongoDB so it survives restarts and is shared by
// every server process. TTL index deletes it once both the window and any lockout are over.
const loginAttemptSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  failures: { type: Number, default: 0 },
  windowStart: Date,
  lockedUntil: Date,
  expireAt: { type: Date, index: { expires: 0 } },
}, { versionKey: false });

module.exports = mongoose.model('LoginAttempt', loginAttemptSchema);
