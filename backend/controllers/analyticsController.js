const Movement = require('../models/Movement');

const fail = (message) => Object.assign(new Error(message), { status: 400 });
const wrap = (fn) => async (req, res, next) => {
  try { await fn(req, res); } catch (e) {
    if (e.status) return res.status(e.status).json({ message: e.message });
    next(e);
  }
};
const DAY = 864e5, MAX_DAYS = 3660;

const date = (v, name) => {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw fail(`${name} must be a date (YYYY-MM-DD)`);
  const d = new Date(v);
  if (Number.isNaN(+d) || d.getUTCFullYear() < 1970 || d.getUTCFullYear() > 2100) throw fail(`${name} must be a valid date`);
  return d;
};
// [from, to] inclusive days, default = last 30 days (today included). start/end is the half-open UTC range to query.
function range(q) {
  const today = new Date(new Date().toISOString().slice(0, 10));
  const to = q.to === undefined ? today : date(q.to, 'to');
  const from = q.from === undefined ? new Date(+to - 29 * DAY) : date(q.from, 'from');
  if (from > to) throw fail('from must not be after to');
  if ((to - from) / DAY + 1 > MAX_DAYS) throw fail(`range must be at most ${MAX_DAYS} days`);
  return { from, to, start: from, end: new Date(+to + DAY) };
}
const day = (d) => d.toISOString().slice(0, 10);
const r2 = (n) => Math.round(n * 100) / 100;

// Bucketed volume: one row per bucket that has movements, { bucket, IN|OUT|RETURN: { count, quantity, amount } }.
exports.volume = wrap(async (req, res) => {
  const { from, to, start, end } = range(req.query);
  const bucket = req.query.bucket === undefined ? 'day' : req.query.bucket;
  if (!['day', 'week'].includes(bucket)) throw fail('bucket must be day or week');
  const rows = await Movement.aggregate([
    { $match: { movementDate: { $gte: start, $lt: end } } },
    { $group: {
      _id: { b: { $dateTrunc: { date: '$movementDate', unit: bucket, timezone: 'UTC', startOfWeek: 'monday' } }, type: '$type' },
      count: { $sum: 1 }, quantity: { $sum: '$quantity' }, amount: { $sum: '$amount' },
    } },
    { $sort: { '_id.b': 1 } },
  ]);
  const byBucket = new Map();
  const totals = { IN: { count: 0, quantity: 0, amount: 0 }, OUT: { count: 0, quantity: 0, amount: 0 }, RETURN: { count: 0, quantity: 0, amount: 0 } };
  for (const r of rows) {
    const key = day(r._id.b);
    if (!byBucket.has(key)) byBucket.set(key, { bucket: key });
    byBucket.get(key)[r._id.type] = { count: r.count, quantity: r2(r.quantity), amount: r2(r.amount) };
    const t = totals[r._id.type];
    t.count += r.count; t.quantity += r.quantity; t.amount += r.amount;
  }
  for (const t of Object.values(totals)) { t.quantity = r2(t.quantity); t.amount = r2(t.amount); }
  res.json({ from: day(from), to: day(to), bucket, totals, buckets: [...byBucket.values()] });
});

// Top N materials by summed value (default) or quantity in the period.
exports.topMaterials = wrap(async (req, res) => {
  const { from, to, start, end } = range(req.query);
  const by = req.query.by === undefined ? 'value' : req.query.by;
  if (!['value', 'quantity'].includes(by)) throw fail('by must be value or quantity');
  const raw = req.query.limit;
  const l = raw === undefined ? 10 : (typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : NaN);
  if (!Number.isInteger(l) || l < 1 || l > 50) throw fail('limit must be a whole number from 1 to 50');
  const rows = await Movement.aggregate([
    { $match: { movementDate: { $gte: start, $lt: end } } },
    { $group: { _id: '$material', movements: { $sum: 1 }, quantity: { $sum: '$quantity' }, amount: { $sum: '$amount' } } },
    { $sort: { [by === 'value' ? 'amount' : 'quantity']: -1, _id: 1 } },
    { $limit: l },
    { $lookup: { from: 'materials', localField: '_id', foreignField: '_id', as: 'm' } },
    { $unwind: { path: '$m', preserveNullAndEmptyArrays: true } },
    { $project: { _id: 0, material: '$_id', materialId: '$m.materialId', description: '$m.description', unit: '$m.unit', movements: 1, quantity: 1, amount: 1 } },
  ]);
  res.json({ from: day(from), to: day(to), by, data: rows.map((r) => ({ ...r, quantity: r2(r.quantity), amount: r2(r.amount) })) });
});
