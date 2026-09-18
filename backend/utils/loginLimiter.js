const LoginAttempt = require('../models/LoginAttempt');

const MAX_ATTEMPTS = 5;                 // attempts allowed inside one window
const WINDOW_MS = 15 * 60 * 1000;       // window length, and lockout length

// Every login attempt is *charged before* the password is checked, in one atomic update, so parallel guesses
// cannot slip past the limit and it does not matter whether the guess would have been right.
//   - window: opens at the first attempt; attempts inside it count up; an attempt after it expired starts a new one
//   - the (MAX_ATTEMPTS+1)th attempt in a window starts a WINDOW_MS lockout; attempts during it change nothing
// Returns { blocked, retryAfterSeconds }.
async function charge(email, now = new Date()) {
  const cutoff = new Date(now.getTime() - WINDOW_MS);
  const epoch = new Date(0);
  const lockUntil = new Date(now.getTime() + WINDOW_MS);
  const doc = await LoginAttempt.findOneAndUpdate({ email }, [
    { $set: { _locked: { $gt: [{ $ifNull: ['$lockedUntil', epoch] }, now] }, _inWin: { $gt: [{ $ifNull: ['$windowStart', epoch] }, cutoff] } } },
    { $set: {
      failures: { $cond: ['$_locked', { $ifNull: ['$failures', 0] }, { $cond: ['$_inWin', { $add: [{ $ifNull: ['$failures', 0] }, 1] }, 1] }] },
      windowStart: { $cond: [{ $or: ['$_locked', '$_inWin'] }, { $ifNull: ['$windowStart', now] }, now] },
    } },
    { $set: { lockedUntil: { $cond: [{ $and: [{ $not: ['$_locked'] }, { $gt: ['$failures', MAX_ATTEMPTS] }] }, lockUntil, { $ifNull: ['$lockedUntil', null] }] } } },
    { $set: { expireAt: { $max: [{ $add: ['$windowStart', WINDOW_MS] }, { $ifNull: ['$lockedUntil', epoch] }] } } },
    { $unset: ['_locked', '_inWin'] },
  ], { upsert: true, returnDocument: 'after', updatePipeline: true });

  const blocked = !!doc.lockedUntil && doc.lockedUntil > now;
  return { blocked, retryAfterSeconds: blocked ? Math.max(1, Math.ceil((doc.lockedUntil - now) / 1000)) : 0 };
}

const reset = (email) => LoginAttempt.deleteOne({ email });

module.exports = { charge, reset, MAX_ATTEMPTS, WINDOW_MS };
