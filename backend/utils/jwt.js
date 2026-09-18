const jwt = require('jsonwebtoken');

// tv = the user's tokenVersion at sign time; logout bumps it, which invalidates every token issued before
const sign = (user) =>
  jwt.sign({ id: user._id, role: user.role, tv: user.tokenVersion || 0 }, process.env.JWT_SECRET, { expiresIn: '8h', algorithm: 'HS256' });
const verify = (token) => jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });

module.exports = { sign, verify };
