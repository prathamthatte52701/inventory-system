const jwt = require('jsonwebtoken');

const sign = (user) =>
  jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '8h', algorithm: 'HS256' });
const verify = (token) => jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });

module.exports = { sign, verify };
