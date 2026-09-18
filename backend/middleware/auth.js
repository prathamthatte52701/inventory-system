const User = require('../models/User');
const { verify } = require('../utils/jwt');
const { NAME } = require('../utils/cookie');

// The token is read ONLY from the httpOnly cookie. An Authorization header is deliberately ignored.
exports.requireAuth = async (req, res, next) => {
  const token = req.cookies && req.cookies[NAME];
  if (typeof token !== 'string' || !token) return res.status(401).json({ message: 'Authentication required' });
  let payload;
  try {
    payload = verify(token);
  } catch {
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
  try {
    const user = await User.findById(payload.id).select('+tokenVersion');
    if (!user) return res.status(401).json({ message: 'User not found' });
    if ((payload.tv || 0) !== (user.tokenVersion || 0)) return res.status(401).json({ message: 'Session ended, please log in again' });
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
