const mongoose = require('mongoose');
const User = require('../models/User');
const audit = require('../utils/audit');

exports.list = async (req, res, next) => {
  try {
    const filter = req.query.status ? { status: String(req.query.status) } : {};
    res.json(await User.find(filter).sort({ createdAt: -1 }));
  } catch (e) {
    next(e);
  }
};

const decide = (status) => async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'Invalid user id' });
    // atomic: only a pending user can transition, so double-approve is rejected race-free
    const user = await User.findOneAndUpdate(
      { _id: req.params.id, status: 'pending' },
      { status, approvedBy: req.user._id, approvedAt: new Date() },
      { returnDocument: 'after' }
    );
    if (!user) {
      const exists = await User.exists({ _id: req.params.id });
      return exists
        ? res.status(409).json({ message: 'User already processed' })
        : res.status(404).json({ message: 'User not found' });
    }
    await audit(req, status === 'approved' ? 'USER_APPROVE' : 'USER_REJECT', 'User', user._id, { email: user.email });
    res.json(user);
  } catch (e) {
    next(e);
  }
};
exports.setRole = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ message: 'Invalid user id' });
    if (!['admin', 'user'].includes(req.body.role)) return res.status(400).json({ message: 'role must be admin or user' });
    if (String(req.user._id) === id) return res.status(400).json({ message: 'You cannot change your own role' });
    const user = await User.findByIdAndUpdate(id, { role: req.body.role }, { returnDocument: 'after' });
    if (!user) return res.status(404).json({ message: 'User not found' });
    await audit(req, 'USER_ROLE_CHANGE', 'User', user._id, { email: user.email, role: user.role });
    res.json(user);
  } catch (e) {
    next(e);
  }
};

exports.approve = decide('approved');
exports.reject = decide('rejected');
