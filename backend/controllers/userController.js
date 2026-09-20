const { isId } = require('../middleware/fields');
const User = require('../models/User');
const Movement = require('../models/Movement');
const audit = require('../utils/audit');
const { fail, wrap } = require('../utils/errors');
const { paginate, pageEnvelope } = require('../utils/pagination');

exports.list = wrap(async (req, res) => {
  const filter = req.query.status ? { status: String(req.query.status) } : {};
  const pg = paginate(req.query);
  const total = await User.countDocuments(filter);
  const data = pg.skip >= total ? [] : await User.find(filter).sort({ createdAt: -1, _id: -1 }).skip(pg.skip).limit(pg.limit);
  res.json(pageEnvelope(data, pg, total));
});

const decide = (status) => wrap(async (req, res) => {
  if (!isId(req.params.id)) return fail(res, 400, 'Invalid user id');
  // atomic: only a pending user can transition, so double-approve is rejected race-free
  const user = await User.findOneAndUpdate(
    { _id: req.params.id, status: 'pending' },
    { status, approvedBy: req.user._id, approvedAt: new Date() },
    { returnDocument: 'after' }
  );
  if (!user) {
    const exists = await User.exists({ _id: req.params.id });
    return exists ? fail(res, 409, 'User already processed') : fail(res, 404, 'User not found');
  }
  await audit(req, status === 'approved' ? 'USER_APPROVE' : 'USER_REJECT', 'User', user._id, { email: user.email });
  res.json(user);
});

exports.setRole = wrap(async (req, res) => {
  const { id } = req.params;
  if (!isId(id)) return fail(res, 400, 'Invalid user id');
  if (!['admin', 'user'].includes(req.body.role)) return fail(res, 400, 'role must be admin or user');
  if (String(req.user._id) === id.toLowerCase()) return fail(res, 400, 'You cannot change your own role');
  const user = await User.findByIdAndUpdate(id, { role: req.body.role }, { returnDocument: 'after' });
  if (!user) return fail(res, 404, 'User not found');
  await audit(req, 'USER_ROLE_CHANGE', 'User', user._id, { email: user.email, role: user.role });
  res.json(user);
});

// small activity summary for the admin user panel
exports.activity = wrap(async (req, res) => {
  if (!isId(req.params.id)) return fail(res, 400, 'Invalid user id');
  if (!(await User.exists({ _id: req.params.id }))) return fail(res, 404, 'User not found');
  const filter = { createdBy: req.params.id };
  const [movementCount, last] = await Promise.all([
    Movement.countDocuments(filter),
    Movement.findOne(filter).sort({ createdAt: -1 }).select('createdAt').lean(),
  ]);
  res.json({ movementCount, lastMovementAt: last ? last.createdAt : null });
});

// soft delete / restore: same atomic pattern as approve/reject. Nothing is ever removed, so every movement and audit
// entry the user created stays intact and attributed to them.
const setActive = (active) => wrap(async (req, res) => {
  const { id } = req.params;
  if (!isId(id)) return fail(res, 400, 'Invalid user id');
  if (!active && String(req.user._id) === id.toLowerCase()) return fail(res, 400, 'You cannot deactivate your own account');
  // a missing `active` field counts as active, so "currently in the opposite state" is: active !== false  /  active === false
  const user = await User.findOneAndUpdate(
    { _id: id, active: active ? false : { $ne: false } },
    { active },
    { returnDocument: 'after' }
  );
  if (!user) {
    const exists = await User.exists({ _id: id });
    return exists ? fail(res, 409, active ? 'User is already active' : 'User is already deactivated') : fail(res, 404, 'User not found');
  }
  await audit(req, active ? 'USER_REACTIVATE' : 'USER_DEACTIVATE', 'User', user._id, { email: user.email });
  res.json(user);
});
exports.deactivate = setActive(false);
exports.reactivate = setActive(true);

exports.approve = decide('approved');
exports.reject = decide('rejected');
