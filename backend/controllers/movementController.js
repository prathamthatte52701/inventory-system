const mongoose = require('mongoose');
const Material = require('../models/Material');
const Movement = require('../models/Movement');
const audit = require('../utils/audit');
const { apply, recalculate, withLock, ORDER } = require('../utils/costing');
const { parseNum, isId } = require('../middleware/fields');

const fail = (status, message) => Object.assign(new Error(message), { status });
const wrap = (fn) => async (req, res, next) => {
  try { await fn(req, res); } catch (e) {
    if (e.status) return res.status(e.status).json({ message: e.message });
    next(e);
  }
};
const validRate = (v) => !Number.isNaN(parseNum(v));
// body may send the paid rate as enteredRate or rate; only ever honoured for IN
const paidRate = (b) => (b.enteredRate !== undefined ? b.enteredRate : b.rate);

exports.create = wrap(async (req, res) => {
  const { material: materialId, type, note } = req.body;
  const quantity = Number(req.body.quantity);
  let enteredRate = null;
  if (type === 'IN') {
    if (!validRate(paidRate(req.body))) throw fail(400, 'IN requires a rate (>= 0)');
    enteredRate = Number(paidRate(req.body));
  }
  const movementDate = req.body.movementDate ? new Date(req.body.movementDate) : new Date();

  const out = await withLock(String(materialId).toLowerCase(), async () => { // same key whatever the hex case
    const material = await Material.findById(materialId);
    if (!material || !material.isActive) throw fail(404, 'Material not found or inactive');

    const r = apply({ qty: material.currentQuantity, rate: material.currentRate }, { type, quantity, enteredRate });
    let movement = await Movement.create({
      material: material._id, type, quantity, movementDate, note, createdBy: req.user._id, ...r.movement,
    });
    try {
      // back-dated entry lands mid-history, so everything after it must be replayed
      if (await Movement.exists({ material: material._id, movementDate: { $gt: movementDate } })) {
        await recalculate(material);
        movement = await Movement.findById(movement._id);
      } else {
        material.currentQuantity = r.state.qty;
        material.currentRate = r.state.rate;
        await material.save();
      }
    } catch (e) {
      await Movement.deleteOne({ _id: movement._id }); // don't leave a movement the material never absorbed
      throw e;
    }
    return { movement, material };
  });

  await audit(req, 'MOVEMENT_CREATE', 'Movement', out.movement._id, {
    material: out.material.materialId, type, quantity, amount: out.movement.amount,
  });
  const body = { movement: out.movement, material: out.material };
  if (out.movement.exceededStock)
    body.warning = `Requested quantity exceeds available stock; ${out.material.materialId} balance is now ${out.movement.balanceAfter}`;
  res.status(201).json(body);
});

const DEFAULT_LIMIT = 50, MAX_LIMIT = 200;
// query value -> positive integer. Missing = default; anything else that is not plain digits >= 1 is a 400.
const positiveInt = (v, def, name) => {
  if (v === undefined) return def;
  const n = typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : NaN;
  if (!Number.isSafeInteger(n) || n < 1) throw fail(400, `${name} must be a positive whole number`);
  return n;
};

exports.list = wrap(async (req, res) => {
  const filter = {};
  if (req.query.material !== undefined) {
    if (!isId(req.query.material)) throw fail(400, 'Invalid material id');
    filter.material = req.query.material;
  }
  const page = positiveInt(req.query.page, 1, 'page');
  const limit = Math.min(positiveInt(req.query.limit, DEFAULT_LIMIT, 'limit'), MAX_LIMIT); // oversize limit is clamped
  const total = await Movement.countDocuments(filter);
  const skip = (page - 1) * limit;
  const data = skip >= total ? [] : await Movement.find(filter).sort(ORDER).skip(skip).limit(limit) // past the last page: empty, not an error
    .populate('material', 'materialId description unit')
    .populate('createdBy', 'name');
  res.json({ data, page, limit, total, totalPages: Math.ceil(total / limit) });
});

exports.update = wrap(async (req, res) => {
  const { id } = req.params;
  if (!isId(id)) throw fail(400, 'Invalid movement id');
  const first = await Movement.findById(id);
  if (!first) throw fail(404, 'Movement not found');

  const out = await withLock(String(first.material), async () => {
    const mv = await Movement.findById(id); // re-read inside the lock
    if (!mv) throw fail(404, 'Movement not found');
    const b = req.body;
    const next = {
      type: b.type !== undefined ? b.type : mv.type,
      quantity: b.quantity !== undefined ? Number(b.quantity) : mv.quantity,
      movementDate: b.movementDate !== undefined ? new Date(b.movementDate) : mv.movementDate,
      note: b.note !== undefined ? b.note : mv.note,
      enteredRate: null,
    };
    if (next.type === 'IN') {
      const given = paidRate(b);
      if (given !== undefined) {
        if (!validRate(given)) throw fail(400, 'rate must be >= 0');
        next.enteredRate = Number(given);
      } else if (mv.enteredRate !== null && mv.enteredRate !== undefined) {
        next.enteredRate = mv.enteredRate;
      } else {
        throw fail(400, 'Changing to IN requires a rate');
      }
    }
    const changed = next.type !== mv.type || next.quantity !== mv.quantity || +next.movementDate !== +mv.movementDate
      || next.note !== mv.note || next.enteredRate !== (mv.enteredRate ?? null);

    const material = await Material.findById(mv.material);
    if (changed) {
      mv.set({ ...next, isEdited: true, lastEditedBy: req.user._id, lastEditedAt: new Date() });
      await mv.save();
    }
    await recalculate(material); // runs even for a no-op edit; result is then identical
    return { movement: await Movement.findById(id), material, changed };
  });

  await audit(req, 'MOVEMENT_EDIT', 'Movement', out.movement._id, { changed: out.changed, body: req.body });
  res.json({ movement: out.movement, material: out.material });
});
