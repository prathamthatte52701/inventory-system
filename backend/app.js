const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');

const app = express();
// Credentialed CORS: only the listed origins may send the session cookie (the wildcard is not allowed with credentials).
// Vite's dev proxy makes the app same-origin, so this only matters when the frontend is served from another origin.
const allowedOrigins = () => (process.env.CORS_ORIGIN || 'http://localhost:2000').split(',').map((s) => s.trim()).filter(Boolean);
app.use(cors({
  origin: (origin, cb) => cb(null, !origin || allowedOrigins().includes(origin)),
  credentials: true,
  exposedHeaders: ['Content-Disposition', 'Retry-After'], // readable by a cross-origin frontend
}));
app.use(cookieParser());
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
app.use('/api/audit', require('./routes/audit'));
app.use('/api/analytics', require('./routes/analytics'));

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
