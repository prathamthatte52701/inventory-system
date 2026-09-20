const Material = require('../models/Material');
const Movement = require('../models/Movement');
const audit = require('../utils/audit');
const { recalculate, postMovement, withLock, ORDER } = require('../utils/costing');
const { parseNum, isId } = require('../middleware/fields');
const { httpError, wrap } = require('../utils/errors');
const { paginate, pageEnvelope } = require('../utils/pagination');
const { createMovement } = require('../utils/movementService');

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

  const out = await createMovement(materialId, { type, quantity, enteredRate, movementDate, note, createdBy: req.user._id });

  await audit(req, 'MOVEMENT_CREATE', 'Movement', out.movement._id, {
    material: out.material.materialId, type, quantity, amount: out.movement.amount,
  });
  res.status(201).json({ movement: out.movement, material: out.material });
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

// A correction never rewrites the original. It posts a reversing entry and a corrected entry (both linked through
// correctionOf) and marks the original as superseded. The reversal is built mechanically from the original:
//   IN -> OUT of the same quantity; OUT -> IN of the same quantity at the rate the OUT was costed at; RETURN -> OUT.
// Weighted-average costing is order dependent, so if other movements happened in between, the average going forward is
// close to, but not bit-for-bit, what rewriting history would have given. That is how a reversing ledger behaves.
exports.update = wrap(async (req, res) => {
  const { id } = req.params;
  if (!isId(id)) throw httpError(400, 'Invalid movement id');
  const first = await Movement.findById(id);
  if (!first) throw httpError(404, 'Movement not found');

  const out = await withLock(String(first.material), async () => {
    const original = await Movement.findById(id); // re-read inside the lock
    if (!original) throw httpError(404, 'Movement not found');
    if (original.isReversal || original.correctionOf)
      throw httpError(400, 'This entry is itself a correction and cannot be corrected. Correct the original movement, or record a new movement.');
    if (original.isEdited || await Movement.exists({ correctionOf: original._id }))
      throw httpError(400, 'This movement has already been corrected and cannot be corrected again. Record a new movement instead.');
    const material = await Material.findById(original.material);
    if (!material) throw httpError(404, 'Material not found');

    // the corrected entry: submitted fields, validated like a normal create; omitted fields carry over from the original
    const b = req.body;
    const type = b.type !== undefined ? b.type : original.type;
    const quantity = b.quantity !== undefined ? Number(b.quantity) : original.quantity;
    let enteredRate = null;
    if (type === 'IN') {
      const given = paidRate(b);
      if (given !== undefined) {
        if (!validRate(given)) throw httpError(400, 'rate must be >= 0');
        enteredRate = Number(given);
      } else if (original.enteredRate !== null && original.enteredRate !== undefined) {
        enteredRate = original.enteredRate;
      } else {
        throw httpError(400, 'Changing to IN requires a rate');
      }
    }
    const now = new Date();
    const note = b.note !== undefined && String(b.note).trim() ? b.note : `Correction of movement ${original._id}`;

    const created = [];
    try {
      const reversal = await postMovement(material, {
        type: original.type === 'OUT' ? 'IN' : 'OUT', quantity: original.quantity,
        enteredRate: original.type === 'OUT' ? original.rate : null,
        movementDate: now, note: `Reversal of movement ${original._id}`, createdBy: req.user._id,
        isReversal: true, correctionOf: original._id,
      });
      created.push(reversal.movement._id);
      // dated when it is posted unless the admin picked a date: booking it right after the reversal keeps the running
      // balance honest (it never dips below the true position between the two entries)
      const corrected = await postMovement(material, {
        type, quantity, enteredRate, movementDate: b.movementDate !== undefined ? new Date(b.movementDate) : now,
        note, createdBy: req.user._id, correctionOf: original._id,
      });
      created.push(corrected.movement._id);
      await Movement.updateOne({ _id: original._id }, { $set: { isEdited: true, lastEditedBy: req.user._id, lastEditedAt: new Date() } }, { timestamps: false });
      return {
        original: await Movement.findById(original._id), reversal: await Movement.findById(reversal.movement._id),
        corrected: await Movement.findById(corrected.movement._id), material: await Material.findById(material._id),
      };
    } catch (e) {
      if (created.length) { // nothing partial is left behind
        await Movement.deleteMany({ _id: { $in: created } });
        await recalculate(material).catch(() => {});
      }
      throw e;
    }
  });

  await audit(req, 'MOVEMENT_CORRECTION', 'Movement', out.original._id, {
    original: out.original._id, reversal: out.reversal._id, corrected: out.corrected._id,
  });
  res.json(out);
});
