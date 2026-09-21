// Builds the import preview: classifies every candidate movement without writing anything.
const Material = require('../models/Material');
const Movement = require('../models/Movement');
const { replay, ORDER } = require('./costing');

const dayOf = (d) => new Date(d).toISOString().slice(0, 10);
const key = (type, quantity, day, rate) => `${type}|${quantity}|${day}|${type === 'IN' ? rate : ''}`;
const inType = (a, b) => (a.type === b.type ? 0 : a.type === 'IN' ? -1 : 1); // within one row IN is posted before OUT

// Would inserting `cand` create a NEW negative balance? Mirrors postMovement. Returns { msg } or { next, balanceAfter }.
function insertCheck(mat, chain, cand) {
  const t = cand.movementDate.getTime();
  let idx = chain.length;
  while (idx > 0 && chain[idx - 1].movementDate.getTime() > t) idx--; // planned goes after existing on the same day
  const next = chain.slice(0, idx).concat(cand, chain.slice(idx));
  const before = replay(mat, chain), after = replay(mat, next);
  if (idx === chain.length) { // live entry
    if (cand.type === 'OUT' && after[idx].balanceAfter < 0) {
      const cur = before.length ? before[before.length - 1].balanceAfter : mat.openingQuantity;
      return { msg: `Cannot record OUT of ${cand.quantity}: only ${Math.max(cur, 0)} ${mat.unit} available.` };
    }
  } else {
    const i = after.findIndex((m, k) => m.balanceAfter < 0 && (k === idx || !(before[k < idx ? k : k - 1].balanceAfter < 0)));
    if (i >= 0) return { msg: `Cannot insert this back-dated ${cand.type}: it would make stock negative on ${dayOf(next[i].movementDate)} after replay.` };
  }
  return { next, balanceAfter: after[idx].balanceAfter };
}

const round4 = (n) => Math.round(n * 1e4) / 1e4;

async function buildPlan(rows, parseErrors) {
  const edps = [...new Set(rows.map((r) => r.edp.toUpperCase()))];
  const mats = await Material.find({ materialId: { $in: edps } }).lean();
  const byEdp = new Map(mats.map((m) => [m.materialId, m]));
  const existing = new Map();
  for (const m of await Movement.find({ material: { $in: mats.map((m) => m._id) } }).sort(ORDER).lean()) {
    const k = String(m.material);
    if (!existing.has(k)) existing.set(k, []);
    existing.get(k).push(m);
  }

  const materials = [], perEdp = new Map();
  for (const r of rows) {
    const edp = r.edp.toUpperCase();
    if (!byEdp.has(edp) && !materials.some((m) => m.edp === edp)) // first row of a new EDP provides the opening values
      materials.push({ edp, description: (r.size || edp).slice(0, 200), unit: 'TBD', openingQuantity: r.stock, openingRate: r.rate ?? 0 });
    if (!perEdp.has(edp)) perEdp.set(edp, []);
    const c = { row: r.row, edp, description: r.size || edp, balance: r.balance };
    if (r.receipt > 0) perEdp.get(edp).push({ ...c, type: 'IN', quantity: r.receipt, rate: r.rate, date: r.receiveDate, last: !(r.issue > 0), warn: r.receiveDefault ? "No Receive Date column in file — used today's date." : null });
    if (r.issue > 0) perEdp.get(edp).push({ ...c, type: 'OUT', quantity: r.issue, rate: null, date: r.issueDate, last: true, warn: r.issueDefault ? "No Issue Date column in file — used today's date." : null });
  }
  const newSet = new Set(materials.map((m) => m.edp));

  const movements = [];
  for (const [edp, cands] of perEdp) {
    const isNew = newSet.has(edp);
    const doc = byEdp.get(edp);
    const mat = isNew ? materials.find((m) => m.edp === edp) : doc;
    const old = isNew ? [] : existing.get(String(doc._id)) || [];
    let chain = old.map((m) => ({ type: m.type, quantity: m.quantity, enteredRate: m.enteredRate, movementDate: m.movementDate }));
    const existingKeys = new Set(old.map((m) => key(m.type, m.quantity, dayOf(m.movementDate), m.enteredRate)));
    const fileKeys = new Set();
    cands.sort((a, b) => a.date.localeCompare(b.date) || a.row - b.row || inType(a, b));
    for (const c of cands) {
      const out = { id: `r${c.row}-${c.type}`, row: c.row, edp, description: c.description, type: c.type, quantity: c.quantity, rate: c.rate, movementDate: c.date, newMaterial: isNew };
      if (c.warn) out.warning = c.warn;
      const skip = (status, reason) => { out.status = status; out.reason = reason; movements.push(out); };
      if (doc && doc.isActive === false) { skip('rejected', 'Material is inactive'); continue; }
      if (c.type === 'IN' && c.rate === null) { skip('rejected', 'IN requires a rate'); continue; }
      const k = key(c.type, c.quantity, c.date, c.rate);
      if (existingKeys.has(k)) { skip('duplicate-skip', 'Identical movement already exists'); continue; }
      if (fileKeys.has(k)) { skip('duplicate-skip', 'identical row earlier in this file'); continue; }
      const res = insertCheck({ ...mat, unit: mat.unit || 'TBD' }, chain, { type: c.type, quantity: c.quantity, enteredRate: c.type === 'IN' ? c.rate : null, movementDate: new Date(c.date) });
      if (res.msg) { skip('rejected', res.msg); continue; }
      chain = res.next; fileKeys.add(k);
      out.status = isNew ? 'new-material' : 'ok';
      if (c.last && c.balance !== null && Math.abs(c.balance - res.balanceAfter) > 0.0001)
        out.warning = [out.warning, `File balance ${c.balance} differs from system balance ${round4(res.balanceAfter)} after this row`].filter(Boolean).join(' | ');
      movements.push(out);
    }
  }
  movements.sort((a, b) => a.edp.localeCompare(b.edp) || a.movementDate.localeCompare(b.movementDate) || a.row - b.row || inType(a, b));
  const count = (f) => movements.filter(f).length;
  return {
    parseErrors, materials, movements,
    summary: {
      totalRows: rows.length + parseErrors.length, newMaterials: materials.length,
      willCreate: count((m) => m.status === 'ok' || m.status === 'new-material'), willSkip: count((m) => m.status === 'duplicate-skip'),
      willReject: count((m) => m.status === 'rejected'), parseErrors: parseErrors.length,
    },
  };
}

// Duplicate test used by commit (inside the material lock, against the live DB). m.movementDate is a UTC-midnight Date.
const isDuplicate = (materialId, m) => Movement.exists({
  material: materialId, type: m.type, quantity: m.quantity,
  movementDate: { $gte: m.movementDate, $lt: new Date(m.movementDate.getTime() + 86400000) },
  ...(m.type === 'IN' ? { enteredRate: m.enteredRate } : {}),
});

module.exports = { buildPlan, isDuplicate };
