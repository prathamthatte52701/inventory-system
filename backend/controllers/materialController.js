const mongoose = require('mongoose');
const { isId } = require('../middleware/fields');
const Material = require('../models/Material');
const Movement = require('../models/Movement');
const audit = require('../utils/audit');
const { withLock } = require('../utils/costing');

const EDITABLE = ['description', 'unit', 'openingRate', 'openingQuantity', 'minimumQuantity'];
const pick = (src, keys) => Object.fromEntries(keys.filter((k) => src[k] !== undefined).map((k) => [k, src[k]]));

const bad = (res, message) => res.status(400).json({ message });
const badId = (req, res) => !isId(req.params.id) && bad(res, 'Invalid material id');

exports.create = async (req, res, next) => {
  try {
    const data = pick(req.body, ['materialId', ...EDITABLE]);
    // current* start equal to opening values; afterwards only movements change them
    const m = await Material.create({
      ...data,
      currentQuantity: data.openingQuantity || 0,
      currentRate: data.openingRate || 0,
      createdBy: req.user._id,
    });
    await audit(req, 'MATERIAL_CREATE', 'Material', m._id, { materialId: m.materialId });
    res.status(201).json(m);
  } catch (e) {
    if (e.code === 11000) return res.status(409).json({ message: 'Material ID already exists' });
    if (e.name === 'ValidationError') return bad(res, e.message);
    next(e);
  }
};

exports.list = async (req, res, next) => {
  try {
    const filter = {};
    if (req.query.active === 'true') filter.isActive = true;
    if (req.query.active === 'false') filter.isActive = false;
    res.json(await Material.find(filter).sort({ materialId: 1 }));
  } catch (e) {
    next(e);
  }
};

exports.get = async (req, res, next) => {
  try {
    if (badId(req, res)) return;
    const m = await Material.findById(req.params.id);
    if (!m) return res.status(404).json({ message: 'Material not found' });
    res.json(m);
  } catch (e) {
    next(e);
  }
};

exports.update = async (req, res, next) => {
  try {
    if (badId(req, res)) return;
    // shares the movement lock: an opening-value edit must not interleave with a movement being posted
    const out = await withLock(req.params.id.toLowerCase(), async () => {
      const m = await Material.findById(req.params.id);
      if (!m) return { s: 404, b: { message: 'Material not found' } };

      const changes = pick(req.body, EDITABLE);
      const touchesOpening = ['openingRate', 'openingQuantity'].some(
        (k) => changes[k] !== undefined && Number(changes[k]) !== m[k]
      );
      if (touchesOpening && (await Movement.exists({ material: m._id })))
        return { s: 409, b: { message: 'Opening rate/quantity cannot be edited once movements exist' } };
      m.set(changes);
      if (touchesOpening) { // no movements yet, so current values still mirror opening
        m.currentQuantity = m.openingQuantity;
        m.currentRate = m.openingRate;
      }
      await m.save();
      await audit(req, 'MATERIAL_UPDATE', 'Material', m._id, { changes });
      return { s: 200, b: m };
    });
    res.status(out.s).json(out.b);
  } catch (e) {
    if (e.name === 'ValidationError') return bad(res, e.message);
    next(e);
  }
};

const setActive = (isActive) => async (req, res, next) => {
  try {
    if (badId(req, res)) return;
    const m = await Material.findByIdAndUpdate(req.params.id, { isActive }, { returnDocument: 'after' });
    if (!m) return res.status(404).json({ message: 'Material not found' });
    await audit(req, isActive ? 'MATERIAL_REACTIVATE' : 'MATERIAL_DEACTIVATE', 'Material', m._id);
    res.json(m); // idempotent: already in target state is not an error
  } catch (e) {
    next(e);
  }
};
exports.deactivate = setActive(false);
exports.reactivate = setActive(true);
