const crypto = require('crypto');
const Movement = require('../models/Movement');
const Material = require('../models/Material');

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

// ---------- per-material lock ----------
// Correctness rests on an atomic MongoDB lock stored on the Material document, so it holds across any number of
// Node processes. The lock carries an expiry (lockedUntil): if a process dies mid-operation the lock frees itself.
// An in-process FIFO queue sits in front purely so requests from the *same* process wait in line instead of
// polling the database; it can be switched off (lockConfig.localQueue) and correctness does not change.
const lockConfig = {
  ttlMs: 15000,        // how long a holder may keep the lock before others may take it (operations take well under 2s)
  attempts: 40,        // acquire retries before giving up with 409
  baseDelayMs: 25, maxDelayMs: 250, // backoff: 25ms growing x1.5 up to 250ms, plus jitter (about 10s worst case)
  localQueue: true,
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const busy = () => Object.assign(new Error('Material is busy, try again'), { status: 409 });

async function acquire(id) {
  const token = crypto.randomBytes(12).toString('hex');
  let delay = lockConfig.baseDelayMs;
  for (let i = 0; i < lockConfig.attempts; i++) {
    const now = new Date();
    // one atomic step: succeeds only if nobody holds the lock or the holder's lease has expired
    const got = await Material.findOneAndUpdate(
      { _id: id, $or: [{ lockedUntil: { $exists: false } }, { lockedUntil: null }, { lockedUntil: { $lt: now } }] },
      { $set: { lockedUntil: new Date(now.getTime() + lockConfig.ttlMs), lockToken: token } },
      { timestamps: false, projection: { _id: 1 } }
    );
    if (got) return token;
    if (!(await Material.exists({ _id: id }))) return null; // no such material: nothing to protect, caller reports 404
    await sleep(delay + Math.random() * 40);
    delay = Math.min(delay * 1.5, lockConfig.maxDelayMs);
  }
  throw busy();
}
const release = (id, token) =>
  Material.updateOne({ _id: id, lockToken: token }, { $unset: { lockedUntil: 1, lockToken: 1 } }, { timestamps: false }).catch(() => {}); // lease expiry covers a failed release

async function withDbLock(id, fn) {
  const token = await acquire(id);
  try { return await fn(); } finally { if (token) await release(id, token); }
}

const chains = new Map();
function withLock(key, fn) {
  const id = String(key).toLowerCase();
  if (!lockConfig.localQueue) return withDbLock(id, fn);
  const prev = chains.get(id) || Promise.resolve();
  const run = prev.then(() => withDbLock(id, fn), () => withDbLock(id, fn));
  const tail = run.catch(() => {});
  chains.set(id, tail);
  tail.then(() => { if (chains.get(id) === tail) chains.delete(id); });
  return run;
}

module.exports = { apply, recalculate, withLock, lockConfig, ORDER, round };
