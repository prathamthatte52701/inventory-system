const AuditLog = require('../models/AuditLog');
const { isId } = require('../middleware/fields');
const { httpError, wrap } = require('../utils/errors');
const { paginate, pageEnvelope } = require('../utils/pagination');


// filters must be plain strings: ?action[$ne]=x parses to an object and would otherwise reach the query
const text = (v, name) => {
  if (v === undefined) return undefined;
  if (typeof v !== 'string' || !v || v.length > 100) throw httpError(400, `${name} must be text (1-100 chars)`);
  return v;
};
// YYYY-MM-DD (a `to` date covers that whole day) or a full ISO timestamp
const when = (v, name, endOfDay) => {
  if (v === undefined) return undefined;
  const dateOnly = typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
  const d = dateOnly || (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:?\d{2})$/.test(v)) ? new Date(v) : null;
  if (!d || Number.isNaN(+d) || d.getUTCFullYear() < 1970 || d.getUTCFullYear() > 2100) throw httpError(400, `${name} must be a valid date`);
  if (dateOnly && endOfDay) d.setUTCDate(d.getUTCDate() + 1);
  return d;
};

exports.list = wrap(async (req, res) => {
  const q = req.query, filter = {};
  const entityType = text(q.entityType, 'entityType'), action = text(q.action, 'action');
  if (entityType) filter.entityType = entityType;
  if (action) filter.action = action;
  if (q.user !== undefined) {
    if (!isId(q.user)) throw httpError(400, 'Invalid user id');
    filter.user = q.user;
  }
  const from = when(q.from, 'from', false), to = when(q.to, 'to', true);
  if (from && to && from >= to) throw httpError(400, 'from must be before to');
  if (from || to) filter.createdAt = { ...(from && { $gte: from }), ...(to && { $lt: to }) };

  const pg = paginate(q);
  const total = await AuditLog.countDocuments(filter);
  const data = pg.skip >= total ? [] : await AuditLog.find(filter).sort({ createdAt: -1, _id: -1 }).skip(pg.skip).limit(pg.limit).lean();
  res.json(pageEnvelope(data, pg, total));
});
