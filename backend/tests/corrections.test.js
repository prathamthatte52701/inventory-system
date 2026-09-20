// Item 3: a correction posts a reversal + a corrected entry; the original is never rewritten.
const setup = require('./harness');
const Movement = require('../models/Movement');
const Material = require('../models/Material');
const { ORDER, recalculate } = require('../utils/costing');

(async () => {
  const h = await setup('corrections');
  const { t, is, assert, call, near } = h;
  const A = h.admin, U = h.user;

  const put = (id, body, tok = A) => call('PUT', `/movements/${id}`, body, tok);
  const derived = (m) => JSON.stringify([m._id, m.type, m.quantity, m.rate, m.enteredRate, m.amount, m.balanceAfter, m.exceededStock, m.movementDate, m.note, m.createdBy, m.createdAt, m.isReversal, m.correctionOf]);
  const all = (id) => Movement.find({ material: id }).sort(ORDER).lean();
  const world = async (id) => JSON.stringify({
    moves: (await all(id)).map((m) => [derived(m), m.isEdited, m.lastEditedBy]),
    mat: (({ currentQuantity: q, currentRate: r }) => [q, r])(await Material.findById(id).lean()),
  });
  const mk = async (id, ...moves) => {
    const m = await h.newMaterial(id); const out = [];
    for (const [type, q, rate, extra] of moves) { const r = await h.move(m, type, q, rate, extra); is(r, 201); out.push(r.b.movement._id); }
    return [m, out];
  };

  await t('correcting an IN: original frozen, OUT reversal + corrected IN posted, material reflects the net', async () => {
    const [m, [a]] = await mk('C1', ['IN', 10, 100]);
    const before = await Movement.findById(a).lean();
    const r = await put(a, { quantity: 8, enteredRate: 110, note: 'typo' }); is(r, 200);
    const { original, reversal, corrected, material } = r.b;
    const after = await Movement.findById(a).lean();
    assert.strictEqual(derived(after), derived(before)); // every stored field of the original is identical
    assert.strictEqual(after.updatedAt.getTime(), before.updatedAt.getTime());
    assert(after.isEdited === true && after.lastEditedBy && after.lastEditedAt);
    assert.strictEqual(original._id, a);
    assert(reversal.isReversal === true && corrected.isReversal === false);
    assert.strictEqual(reversal.type, 'OUT'); assert.strictEqual(reversal.quantity, 10);
    assert.strictEqual(reversal.note, 'Reversal of movement ' + a);
    assert.strictEqual(reversal.correctionOf, a); assert.strictEqual(corrected.correctionOf, a);
    assert.strictEqual(corrected.type, 'IN'); assert.strictEqual(corrected.quantity, 8);
    assert.strictEqual(corrected.enteredRate, 110); assert.strictEqual(corrected.note, 'typo');
    assert.strictEqual(material.currentQuantity, 8); assert.strictEqual(material.currentRate, 110);
    assert.strictEqual(await Movement.countDocuments({ material: m }), 3);
  });

  await t('correcting an OUT is mirrored: the reversal is an IN at the rate the OUT was costed at', async () => {
    const [, [, o]] = await mk('C2', ['IN', 10, 100], ['OUT', 4]);
    const r = await put(o, { quantity: 3 }); is(r, 200);
    assert.strictEqual(r.b.reversal.type, 'IN'); assert.strictEqual(r.b.reversal.quantity, 4); assert.strictEqual(r.b.reversal.enteredRate, 100);
    assert.strictEqual(r.b.corrected.type, 'OUT'); assert.strictEqual(r.b.corrected.quantity, 3);
    assert.strictEqual(r.b.material.currentQuantity, 7); near(r.b.material.currentRate, 100, 1e-6);
    assert.strictEqual(r.b.original.quantity, 4);
  });

  await t('correcting a RETURN reverses it with an OUT', async () => {
    const [, [, ret]] = await mk('C3', ['IN', 10, 100], ['RETURN', 2]);
    const r = await put(ret, { quantity: 1 }); is(r, 200);
    assert.strictEqual(r.b.reversal.type, 'OUT'); assert.strictEqual(r.b.reversal.quantity, 2);
    assert.strictEqual(r.b.material.currentQuantity, 11);
  });

  await t('no note supplied: the corrected entry says what it corrects', async () => {
    const [, [a]] = await mk('C4', ['IN', 5, 10]);
    const r = await put(a, { quantity: 6 }); is(r, 200);
    assert.strictEqual(r.b.corrected.note, 'Correction of movement ' + a);
    const [, [b]] = await mk('C4b', ['IN', 5, 10]);
    assert.strictEqual((await put(b, { quantity: 6, note: '   ' })).b.corrected.note, 'Correction of movement ' + b);
  });

  await t('an original cannot be corrected twice; a reversal or a corrected entry cannot be corrected at all', async () => {
    const [m, [a]] = await mk('C5', ['IN', 10, 100]);
    const r = await put(a, { quantity: 9 }); is(r, 200);
    const w = await world(m);
    for (const [label, id] of [['original again', a], ['reversal', r.b.reversal._id], ['corrected', r.b.corrected._id]]) {
      const x = await put(id, { quantity: 1 });
      assert.strictEqual(x.s, 400, label);
      assert(/correct/i.test(x.b.message), label + ': ' + x.b.message);
    }
    assert.strictEqual(await world(m), w); // the rejected attempts changed nothing
  });

  await t('two concurrent corrections of the same original: one wins, one is refused, exactly one pair is posted', async () => {
    const [m, [a]] = await mk('C6', ['IN', 10, 100]);
    const rs = await Promise.all([put(a, { quantity: 9 }), put(a, { quantity: 7 })]);
    assert.deepStrictEqual(rs.map((x) => x.s).sort(), [200, 400]);
    assert.strictEqual(await Movement.countDocuments({ material: m }), 3);
  });

  await t('reversal that would exceed stock rejects the whole correction, nothing left behind', async () => {
    const [m, [a]] = await mk('C7', ['IN', 10, 100], ['OUT', 8]);
    const before = await world(m);
    const r = await put(a, { quantity: 5 }); is(r, 400);
    assert.match(r.b.message, /Cannot record OUT of 10: only 2 /);
    assert.strictEqual(await world(m), before);
    assert.strictEqual((await Movement.findById(a)).isEdited, false);
  });

  await t('corrected entry that would exceed stock rejects the whole correction (the reversal is undone too)', async () => {
    const [m, [, o]] = await mk('C8', ['IN', 10, 100], ['OUT', 5]);
    const before = await world(m);
    const r = await put(o, { quantity: 20 }); is(r, 400);
    assert.match(r.b.message, /Cannot record OUT of 20/);
    assert.strictEqual(await world(m), before);
    assert.strictEqual(await Movement.countDocuments({ material: m }), 2);
  });

  await t('a back-dated corrected entry that starves a later OUT is rejected and everything is restored', async () => {
    const [m, [a]] = await mk('C9', ['IN', 10, 100, { movementDate: '2024-05-01' }], ['OUT', 9, undefined, { movementDate: '2024-05-03' }], ['IN', 20, 100, { movementDate: '2024-05-04' }]);
    const before = await world(m);
    // the reversal is fine (stock is 21), but booking an OUT of 5 on 05-02 leaves only 5 for the OUT of 9 on 05-03
    const r = await put(a, { type: 'OUT', quantity: 5, movementDate: '2024-05-02' }); is(r, 400);
    assert.match(r.b.message, /negative on 2024-05-03/);
    assert.strictEqual(await world(m), before);
  });

  await t('validation errors reject before anything is posted', async () => {
    const [m, [a]] = await mk('C10', ['IN', 10, 100]);
    const before = await world(m);
    for (const body of [{ quantity: -1 }, { quantity: 0 }, { quantity: 'x' }, { type: 'XX' }, { enteredRate: -1 }, { movementDate: 'nope' }])
      assert.strictEqual((await put(a, body)).s, 400, JSON.stringify(body));
    const [m2, [, o]] = await mk('C10b', ['IN', 5, 10], ['OUT', 1]);
    assert.strictEqual((await put(o, { type: 'IN' })).s, 400); // IN needs a rate
    assert.strictEqual(await world(m), before);
    assert.strictEqual(await Movement.countDocuments({ material: m2 }), 2);
  });

  await t('access and ids: user 403, anonymous 401, unknown 404, malformed 400', async () => {
    const [, [a]] = await mk('C11', ['IN', 5, 10]);
    is(await put(a, { quantity: 1 }, U), 403);
    is(await call('PUT', '/movements/' + a, { quantity: 1 }), 401);
    is(await put(new h.mongoose.Types.ObjectId(), { quantity: 1 }), 404);
    is(await put('xyz', { quantity: 1 }), 400);
  });

  await t('audit: MOVEMENT_CORRECTION names original, reversal and corrected; no MOVEMENT_EDIT is written', async () => {
    const [, [a]] = await mk('C12', ['IN', 5, 10]);
    const r = await put(a, { quantity: 4 }); is(r, 200);
    const AuditLog = h.mongoose.models.AuditLog;
    const log = await AuditLog.findOne({ action: 'MOVEMENT_CORRECTION' }).sort({ createdAt: -1 }).lean();
    assert(log);
    const d = log.details;
    assert.deepStrictEqual([String(d.original), String(d.reversal), String(d.corrected)], [a, r.b.reversal._id, r.b.corrected._id]);
    assert.strictEqual(await AuditLog.countDocuments({ action: 'MOVEMENT_EDIT' }), 0);
  });

  await t('ledger maths with movements in between: hand-computed result, and a full replay agrees with what is stored', async () => {
    const [m, [, b]] = await mk('C13', ['IN', 10, 100], ['IN', 10, 200], ['OUT', 5]);
    const r = await put(b, { quantity: 10, enteredRate: 300 }); is(r, 200);
    // 10@100 + 10@200 -> 20@150; OUT 5 -> 15@150; reversal OUT 10 -> 5@150; corrected IN 10@300 -> 15 @ (5*150+10*300)/15 = 250
    assert.strictEqual(r.b.material.currentQuantity, 15); near(r.b.material.currentRate, 250, 1e-6);
    const stored = (await all(m)).map(derived);
    const mat = await Material.findById(m);
    const [q0, r0] = [mat.currentQuantity, mat.currentRate];
    await recalculate(mat);
    assert.deepStrictEqual((await all(m)).map(derived), stored);
    assert.strictEqual(mat.currentQuantity, q0); assert.strictEqual(mat.currentRate, r0);
    const ls = (await call('GET', `/movements?material=${m}`, undefined, U)).b; // the list carries the new fields
    assert.strictEqual(ls.filter((x) => x.isReversal).length, 1);
    assert.strictEqual(ls.filter((x) => x.correctionOf).length, 2);
  });

  await t('an admin-chosen date for the corrected entry is honoured (valid back-dated case)', async () => {
    const [m, [a]] = await mk('C14', ['IN', 10, 100, { movementDate: '2024-06-01' }], ['IN', 10, 100, { movementDate: '2024-06-05' }]);
    const r = await put(a, { quantity: 12, movementDate: '2024-06-02' }); is(r, 200);
    assert.strictEqual(new Date(r.b.corrected.movementDate).toISOString().slice(0, 10), '2024-06-02');
    assert.strictEqual(r.b.material.currentQuantity, 22); // 10 + 10 - 10 (reversal) + 12
    assert.strictEqual(await Movement.countDocuments({ material: m }), 4);
  });

  await h.finish();
})();
