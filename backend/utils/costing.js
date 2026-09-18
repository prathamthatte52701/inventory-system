const Movement = require('../models/Movement');

const round = (n, d) => Math.round((n + Number.EPSILON) * 10 ** d) / 10 ** d;
const ORDER = { movementDate: 1, createdAt: 1, _id: 1 };

// Single source of truth for costing, used by both live entry and full replay.
// state = { qty, rate } (running quantity and weighted average rate).
function apply(state, { type, quantity, enteredRate }) {
  let { qty, rate } = state;
  let mRate, exceeded = false, entered = null;
  if (type === 'IN') {
    // weighted average; if stock is <= 0 there is nothing to blend with, so the new rate wins
    rate = qty <= 0 ? enteredRate : (qty * rate + quantity * enteredRate) / (qty + quantity);
    rate = round(rate, 6);
    mRate = enteredRate; // display rate = what was actually paid
    entered = enteredRate;
    qty += quantity;
  } else if (type === 'OUT') {
    mRate = rate;
    exceeded = quantity > qty;
    qty -= quantity;
  } else { // RETURN: back at current rate, average unchanged
    mRate = rate;
    qty += quantity;
  }
  qty = round(qty, 4);
  return {
    movement: { rate: mRate, enteredRate: entered, amount: round(quantity * mRate, 2), balanceAfter: qty, exceededStock: exceeded },
    state: { qty, rate },
  };
}

// Replays every movement of a material from its opening baseline and rewrites derived fields.
async function recalculate(material) {
  const moves = await Movement.find({ material: material._id }).sort(ORDER).lean();
  let state = { qty: material.openingQuantity, rate: material.openingRate };
  const ops = [];
  for (const m of moves) {
    const r = apply(state, { type: m.type, quantity: m.quantity, enteredRate: m.enteredRate });
    state = r.state;
    const { enteredRate, ...set } = r.movement; // enteredRate is preserved input, never overwritten
    ops.push({ updateOne: { filter: { _id: m._id }, update: { $set: set } } });
  }
  if (ops.length) await Movement.bulkWrite(ops);
  material.currentQuantity = state.qty;
  material.currentRate = state.rate;
  await material.save();
  return material;
}

// ponytail: in-process per-material mutex; fine for one server process, use DB transactions/locks if scaled out.
const chains = new Map();
function withLock(key, fn) {
  const prev = chains.get(key) || Promise.resolve();
  const run = prev.then(fn, fn);
  const tail = run.catch(() => {});
  chains.set(key, tail);
  tail.then(() => { if (chains.get(key) === tail) chains.delete(key); });
  return run;
}

module.exports = { apply, recalculate, withLock, ORDER, round };
