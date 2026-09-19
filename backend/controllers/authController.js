const bcrypt = require('bcryptjs');
const User = require('../models/User');
const { sign, verify } = require('../utils/jwt');
const { NAME, setAuthCookie, clearAuthCookie } = require('../utils/cookie');
const limiter = require('../utils/loginLimiter');
const audit = require('../utils/audit');
const { fail } = require('../utils/errors');

exports.signup = async (req, res, next) => {
  try {
    // limits read per request so they can be tuned via env; charged before any lookup/hashing so bursts cannot slip past
    const windowMs = Number(process.env.SIGNUP_RATE_WINDOW_MS) || 60 * 60 * 1000;
    const maxAttempts = Number(process.env.SIGNUP_RATE_MAX) || 5;
    const { blocked, retryAfterSeconds } = await limiter.charge(`signup:ip:${req.ip}`, { maxAttempts, windowMs });
    if (blocked) {
      res.set('Retry-After', String(retryAfterSeconds));
      return res.status(429).json({
        message: `Too many signups from this address. Try again in ${Math.ceil(retryAfterSeconds / 60)} minute(s).`,
        retryAfterSeconds,
      });
    }

    const { name, email, password } = req.body;
    if (await User.findOne({ email: email.toLowerCase() })) return fail(res, 409, 'Email already registered');
    // role/status are never taken from the body
    const user = await User.create({ name, email, passwordHash: await User.hashPassword(password) });
    await audit(req, 'SIGNUP', 'User', user._id, {}, user);
    res.status(201).json({ message: 'Signup received. Awaiting admin approval.', id: user._id, status: user.status });
  } catch (e) {
    if (e.code === 11000) return fail(res, 409, 'Email already registered');
    next(e);
  }
};

// compared against when the email is unknown, so "no such user" costs the same time as "wrong password"
const DUMMY_HASH = bcrypt.hashSync('timing-equaliser', 10);

exports.login = async (req, res, next) => {
  try {
    const { password } = req.body;
    const email = req.body.email.toLowerCase();

    // charged up front: the lockout depends on how many attempts were made, never on whether one was correct
    const { blocked, retryAfterSeconds } = await limiter.charge(email);
    if (blocked) {
      res.set('Retry-After', String(retryAfterSeconds));
      return res.status(429).json({
        message: `Too many login attempts. Try again in ${Math.ceil(retryAfterSeconds / 60)} minute(s).`,
        retryAfterSeconds,
      });
    }

    const user = await User.findOne({ email }).select('+passwordHash +tokenVersion');
    const ok = user ? await user.comparePassword(password) : (await bcrypt.compare(password, DUMMY_HASH), false);
    if (!ok) return fail(res, 401, 'Invalid email or password');

    await limiter.reset(email); // correct password: the counter starts over
    if (user.status === 'pending') return fail(res, 403, 'Account pending admin approval');
    if (user.status === 'rejected') return fail(res, 403, 'Account rejected');
    await audit(req, 'LOGIN', 'User', user._id, {}, user);
    setAuthCookie(res, sign(user)); // the token is never put in the response body
    res.json({ user: { id: user._id, name: user.name, email: user.email, role: user.role } });
  } catch (e) {
    next(e);
  }
};

exports.logout = async (req, res, next) => {
  try {
    const token = req.cookies && req.cookies[NAME];
    if (typeof token === 'string' && token) {
      try {
        // bump tokenVersion so the token that was just in the cookie is dead server-side too, even if a copy exists somewhere
        const p = verify(token);
        const same = (p.tv || 0) === 0 ? [{ tokenVersion: 0 }, { tokenVersion: { $exists: false } }] : [{ tokenVersion: p.tv }];
        const user = await User.findOneAndUpdate({ _id: p.id, $or: same }, { $inc: { tokenVersion: 1 } }, { returnDocument: 'after' });
        if (user) await audit(req, 'LOGOUT', 'User', user._id, {}, user);
      } catch { /* invalid/expired token: nothing to revoke, still clear the cookie */ }
    }
    clearAuthCookie(res);
    res.json({ message: 'Logged out' });
  } catch (e) {
    next(e);
  }
};

exports.me = (req, res) => {
  const { _id, name, email, role, status } = req.user;
  res.json({ id: _id, name, email, role, status });
};
