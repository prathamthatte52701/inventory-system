const bcrypt = require('bcryptjs');
const User = require('../models/User');
const { sign } = require('../utils/jwt');
const audit = require('../utils/audit');

exports.signup = async (req, res, next) => {
  try {
    const { name, email, password } = req.body;
    if (await User.findOne({ email: email.toLowerCase() }))
      return res.status(409).json({ message: 'Email already registered' });
    // role/status are never taken from the body
    const user = await User.create({ name, email, passwordHash: await User.hashPassword(password) });
    await audit(req, 'SIGNUP', 'User', user._id, {}, user);
    res.status(201).json({ message: 'Signup received. Awaiting admin approval.', id: user._id, status: user.status });
  } catch (e) {
    if (e.code === 11000) return res.status(409).json({ message: 'Email already registered' });
    next(e);
  }
};

// compared against when the email is unknown, so "no such user" costs the same time as "wrong password"
const DUMMY_HASH = bcrypt.hashSync('timing-equaliser', 10);

exports.login = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email: email.toLowerCase() }).select('+passwordHash');
    const ok = user ? await user.comparePassword(password) : (await bcrypt.compare(password, DUMMY_HASH), false);
    if (!ok) return res.status(401).json({ message: 'Invalid email or password' });
    if (user.status === 'pending') return res.status(403).json({ message: 'Account pending admin approval' });
    if (user.status === 'rejected') return res.status(403).json({ message: 'Account rejected' });
    await audit(req, 'LOGIN', 'User', user._id, {}, user);
    res.json({
      token: sign(user),
      user: { id: user._id, name: user.name, email: user.email, role: user.role },
    });
  } catch (e) {
    next(e);
  }
};

exports.me = (req, res) => {
  const { _id, name, email, role, status } = req.user;
  res.json({ id: _id, name, email, role, status });
};
