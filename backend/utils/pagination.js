// Shared pagination contract: ?page (default 1) and ?limit (default 50, at most 200).
// Extracted unchanged from the movement and audit controllers, so behaviour is identical:
//   - missing            -> the default
//   - not plain digits, < 1, or unsafe -> 400 "<name> must be a positive whole number"
//   - limit above MAX_LIMIT -> clamped to MAX_LIMIT (never rejected)
//   - a page past the last one is not an error: callers return an empty `data` array
const { httpError } = require('./errors');

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function positiveInt(value, fallback, name = 'value') {
  if (value === undefined) return fallback;
  const n = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(n) || n < 1) throw httpError(400, `${name} must be a positive whole number`);
  return n;
}

// paginate({ page, limit }) with the raw query values -> { page, limit, skip } ready for .skip(skip).limit(limit)
function paginate({ page, limit } = {}) {
  const p = positiveInt(page, 1, 'page');
  const l = Math.min(positiveInt(limit, DEFAULT_LIMIT, 'limit'), MAX_LIMIT);
  return { page: p, limit: l, skip: (p - 1) * l };
}

// the response body every paginated endpoint returns
const pageEnvelope = (data, { page, limit }, total) => ({ data, page, limit, total, totalPages: Math.ceil(total / limit) });

module.exports = { DEFAULT_LIMIT, MAX_LIMIT, positiveInt, paginate, pageEnvelope };
