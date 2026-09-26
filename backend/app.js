const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');

const app = express();
// helmet's defaults assume a server that also renders HTML/JS itself; this backend only ever returns JSON (or a
// streamed report file) to two separate SPA frontends on other origins/ports, credentialed via CORS below — so a
// few defaults are wrong for this shape and are turned off or customised rather than accepted as-is:
//   - contentSecurityPolicy: a document-oriented CSP is inert (and occasionally misleading in devtools) for a
//     JSON-only API that never serves HTML; each frontend is its own document and owns its own CSP concern.
//   - crossOriginResourcePolicy: helmet's default is 'same-origin', which makes browsers refuse to hand a
//     cross-origin caller the response body even though CORS above explicitly allows it — a well-known
//     helmet+CORS interaction. This API is deliberately read cross-origin by both frontends, so it's set to
//     'cross-origin' on purpose, not left to the default.
//   - strictTransportSecurity (HSTS): only makes sense once the app is actually served over HTTPS. Sending it
//     during plain-HTTP local dev is at best a no-op (browsers ignore HSTS delivered over HTTP) and at worst
//     confusing, so it's gated on the same COOKIE_SECURE flag the session cookie already uses for the same reason.
// Everything else (frameguard, nosniff, hidden X-Powered-By, referrer policy, disabled legacy XSS-filter header,
// etc.) is left at helmet's default — none of it interacts with fetch/XHR or the report downloads below.
const secureDeploy = process.env.COOKIE_SECURE === 'true';
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  ...(secureDeploy ? {} : { strictTransportSecurity: false }),
}));
// Credentialed CORS: only the listed origins may send the session cookie (the wildcard is not allowed with credentials).
// Vite's dev proxy makes the app same-origin, so this only matters when the frontend is served from another origin.
const allowedOrigins = () => (process.env.CORS_ORIGIN || 'http://localhost:2000').split(',').map((s) => s.trim()).filter(Boolean);
app.use(cors({
  origin: (origin, cb) => cb(null, !origin || allowedOrigins().includes(origin)),
  credentials: true,
  exposedHeaders: ['Content-Disposition', 'Retry-After'], // readable by a cross-origin frontend
}));
app.use(cookieParser());
app.use('/api/imports', require('./middleware/auth').requireAuth, express.json({ limit: '5mb' })); // authenticate before buffering a large body // a ~350-row import plan exceeds the default; body-parser skips already-parsed bodies
app.use(express.json({ limit: '100kb' }));
app.use((req, res, next) => { // express 5 leaves req.body undefined when no JSON was sent; controllers expect an object
  if (req.body === undefined) req.body = {};
  next();
});
if (process.env.NODE_ENV !== 'test') app.use(morgan('dev')); // morgan never logs bodies

app.get('/api/health', (req, res) => res.json({ ok: true }));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/materials', require('./routes/materials'));
app.use('/api/movements', require('./routes/movements'));
app.use('/api/imports', require('./routes/imports'));
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
