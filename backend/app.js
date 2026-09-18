const express = require('express');
const cors = require('cors');
const morgan = require('morgan');

const app = express();
app.use(cors({ exposedHeaders: ['Content-Disposition'] })); // lets a cross-origin frontend read the download filename
app.use(express.json({ limit: '100kb' }));
app.use((req, res, next) => { // express 5 leaves req.body undefined when no JSON was sent; controllers expect an object
  if (req.body === undefined) req.body = {};
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
});
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
  if (err.type === 'entity.too.large') return res.status(413).json({ message: 'Request body too large' });
  // other client errors raised by express itself (e.g. undecodable URL path) keep their 4xx
  if (err.status >= 400 && err.status < 500) return res.status(err.status).json({ message: 'Bad request' });
  console.error(err.message);
  res.status(500).json({ message: 'Internal server error' });
});

module.exports = app;
