const User = require('../models/User');
const { verify } = require('../utils/jwt');

exports.requireAuth = async (req, res, next) => {
  const h = req.headers.authorization || '';
  if (!h.startsWith('Bearer ')) return res.status(401).json({ message: 'Authentication required' });
  let payload;
  try {
    payload = verify(h.slice(7));
  } catch {
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
  try {
    const user = await User.findById(payload.id);
    if (!user) return res.status(401).json({ message: 'User not found' });
    // re-checked on every request so revoked users lose access immediately
    if (user.status !== 'approved') return res.status(403).json({ message: 'Account not approved' });
    req.user = user;
    next();
  } catch (e) {
    next(e);
  }
};

exports.requireAdmin = (req, res, next) =>
  req.user && req.user.role === 'admin'
    ? next()
    : res.status(403).json({ message: 'Admin access required' });
