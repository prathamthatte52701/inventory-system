const Material = require('../models/Material');
const Movement = require('../models/Movement');
const audit = require('../utils/audit');
const { apply, recalculate, withLock, ORDER } = require('../utils/costing');
const { parseNum, isId } = require('../middleware/fields');
const { httpError, wrap } = require('../utils/errors');
const { paginate, pageEnvelope } = require('../utils/pagination');

const validRate = (v) => !Number.isNaN(parseNum(v));
// body may send the paid rate as enteredRate or rate; only ever honoured for IN
const paidRate = (b) => (b.enteredRate !== undefined ? b.enteredRate : b.rate);

exports.create = wrap(async (req, res) => {
  const { material: materialId, type, note } = req.body;
  const quantity = Number(req.body.quantity);
  let enteredRate = null;
  if (type === 'IN') {
    if (!validRate(paidRate(req.body))) throw httpError(400, 'IN requires a rate (>= 0)');
    enteredRate = Number(paidRate(req.body));
  }
  const movementDate = req.body.movementDate ? new Date(req.body.movementDate) : new Date();

  const out = await withLock(String(materialId).toLowerCase(), async () => { // same key whatever the hex case
    const material = await Material.findById(materialId);
    if (!material || !material.isActive) throw httpError(404, 'Material not found or inactive');

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

exports.list = wrap(async (req, res) => {
  const filter = {};
  if (req.query.material !== undefined) {
    if (!isId(req.query.material)) throw httpError(400, 'Invalid material id');
    filter.material = req.query.material;
  }
  const pg = paginate(req.query);
  const { skip, limit } = pg;
  const total = await Movement.countDocuments(filter);
  const data = skip >= total ? [] : await Movement.find(filter).sort(ORDER).skip(skip).limit(limit) // past the last page: empty, not an error
    .populate('material', 'materialId description unit')
    .populate('createdBy', 'name');
  res.json(pageEnvelope(data, pg, total));
});

exports.update = wrap(async (req, res) => {
  const { id } = req.params;
  if (!isId(id)) throw httpError(400, 'Invalid movement id');
  const first = await Movement.findById(id);
  if (!first) throw httpError(404, 'Movement not found');

  const out = await withLock(String(first.material), async () => {
    const mv = await Movement.findById(id); // re-read inside the lock
    if (!mv) throw httpError(404, 'Movement not found');
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
        if (!validRate(given)) throw httpError(400, 'rate must be >= 0');
        next.enteredRate = Number(given);
      } else if (mv.enteredRate !== null && mv.enteredRate !== undefined) {
        next.enteredRate = mv.enteredRate;
      } else {
        throw httpError(400, 'Changing to IN requires a rate');
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
