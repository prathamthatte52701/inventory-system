const jwt = require('jsonwebtoken');

const sign = (user) =>
  jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '8h' });
const verify = (token) => jwt.verify(token, process.env.JWT_SECRET);

module.exports = { sign, verify };
