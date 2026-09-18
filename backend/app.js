const express = require('express');
const cors = require('cors');
const morgan = require('morgan');

const app = express();
app.use(cors());
app.use(express.json({ limit: '100kb' }));
if (process.env.NODE_ENV !== 'test') app.use(morgan('dev')); // morgan never logs bodies

app.get('/api/health', (req, res) => res.json({ ok: true }));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/materials', require('./routes/materials'));
app.use('/api/movements', require('./routes/movements'));
app.use('/api/reports', require('./routes/reports'));

app.use((req, res) => res.status(404).json({ message: 'Route not found' }));
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  if (err.type === 'entity.parse.failed') return res.status(400).json({ message: 'Malformed JSON' });
  console.error(err.message);
  res.status(500).json({ message: 'Internal server error' });
});

module.exports = app;
