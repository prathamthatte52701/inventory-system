const AuditLog = require('../models/AuditLog');
const { isId } = require('../middleware/fields');

const fail = (status, message) => Object.assign(new Error(message), { status });
const wrap = (fn) => async (req, res, next) => {
  try { await fn(req, res); } catch (e) {
    if (e.status) return res.status(e.status).json({ message: e.message });
    next(e);
  }
};

// same pagination contract as GET /movements: default 50, max 200, plain positive integers only
const DEFAULT_LIMIT = 50, MAX_LIMIT = 200;
const positiveInt = (v, def, name) => {
  if (v === undefined) return def;
  const n = typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : NaN;
  if (!Number.isSafeInteger(n) || n < 1) throw fail(400, `${name} must be a positive whole number`);
  return n;
};
// filters must be plain strings: ?action[$ne]=x parses to an object and would otherwise reach the query
const text = (v, name) => {
  if (v === undefined) return undefined;
  if (typeof v !== 'string' || !v || v.length > 100) throw fail(400, `${name} must be text (1-100 chars)`);
  return v;
};
// YYYY-MM-DD (a `to` date covers that whole day) or a full ISO timestamp
const when = (v, name, endOfDay) => {
  if (v === undefined) return undefined;
  const dateOnly = typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
  const d = dateOnly || (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:?\d{2})$/.test(v)) ? new Date(v) : null;
  if (!d || Number.isNaN(+d) || d.getUTCFullYear() < 1970 || d.getUTCFullYear() > 2100) throw fail(400, `${name} must be a valid date`);
  if (dateOnly && endOfDay) d.setUTCDate(d.getUTCDate() + 1);
  return d;
};

exports.list = wrap(async (req, res) => {
  const q = req.query, filter = {};
  const entityType = text(q.entityType, 'entityType'), action = text(q.action, 'action');
  if (entityType) filter.entityType = entityType;
  if (action) filter.action = action;
  if (q.user !== undefined) {
    if (!isId(q.user)) throw fail(400, 'Invalid user id');
    filter.user = q.user;
  }
  const from = when(q.from, 'from', false), to = when(q.to, 'to', true);
  if (from && to && from >= to) throw fail(400, 'from must be before to');
  if (from || to) filter.createdAt = { ...(from && { $gte: from }), ...(to && { $lt: to }) };

  const page = positiveInt(q.page, 1, 'page');
  const limit = Math.min(positiveInt(q.limit, DEFAULT_LIMIT, 'limit'), MAX_LIMIT);
  const total = await AuditLog.countDocuments(filter);
  const skip = (page - 1) * limit;
  const data = skip >= total ? [] : await AuditLog.find(filter).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit).lean();
  res.json({ data, page, limit, total, totalPages: Math.ceil(total / limit) });
});
