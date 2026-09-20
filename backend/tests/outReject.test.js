// Item 2: an OUT that would take stock below zero is rejected outright (live entry and back-dated replay alike).
const setup = require('./harness');
const Movement = require('../models/Movement');
const Material = require('../models/Material');
const { ORDER } = require('../utils/costing');

(async () => {
  const h = await setup('outReject');
  const { t, is, assert, call } = h;
  const U = h.user;

  // every stored field that matters, for exact before/after comparisons
  const snap = async (id) => JSON.stringify({
    moves: (await Movement.find({ material: id }).sort(ORDER).lean()).map((m) => [m._id, m.type, m.quantity, m.rate, m.enteredRate, m.amount, m.balanceAfter, m.exceededStock, m.movementDate, m.note]),
    mat: (({ currentQuantity, currentRate }) => ({ currentQuantity, currentRate }))(await Material.findById(id).lean()),
  });
  const count = (id) => Movement.countDocuments({ material: id });
  const qty = async (id) => (await Material.findById(id).lean()).currentQuantity;

  await t('live OUT above stock: 400 with the exact message, nothing created, material untouched', async () => {
    const m = await h.newMaterial('R1', { unit: 'Bag' });
    await h.move(m, 'IN', 10, 100);
    const before = await snap(m);
    const r = await h.move(m, 'OUT', 10.5); is(r, 400);
    assert.strictEqual(r.b.message, 'Cannot record OUT of 10.5: only 10 Bag available.');
    assert.strictEqual(await count(m), 1);
    assert.strictEqual(await snap(m), before);
  });

  await t('OUT on an empty material is rejected', async () => {
    const m = await h.newMaterial('R2');
    const r = await h.move(m, 'OUT', 1); is(r, 400);
    assert.strictEqual(await count(m), 0);
  });

  await t('OUT exactly equal to stock succeeds (balance 0); a tiny OUT below stock succeeds', async () => {
    const m = await h.newMaterial('R3');
    await h.move(m, 'IN', 10, 100);
    const a = await h.move(m, 'OUT', 9.9999); is(a, 201);
    assert.strictEqual(a.b.movement.balanceAfter, 0.0001);
    assert.strictEqual(a.b.movement.exceededStock, false);
    const b = await h.move(m, 'OUT', 0.0001); is(b, 201);
    assert.strictEqual(b.b.movement.balanceAfter, 0);
    assert.strictEqual(await h.move(m, 'OUT', 0.0001).then((r) => r.s), 400); // now truly empty
  });

  await t('the exceeded-stock warning no longer exists on any successful create', async () => {
    const m = await h.newMaterial('R4');
    const r = await h.move(m, 'IN', 5, 10); is(r, 201);
    assert(!('warning' in r.b));
  });

  await t('RETURN and IN are never blocked', async () => {
    const m = await h.newMaterial('R5');
    is(await h.move(m, 'RETURN', 3), 201);
    is(await h.move(m, 'IN', 3, 5), 201);
  });

  await t('back-dated OUT that stays valid after replay succeeds with correct balances', async () => {
    const m = await h.newMaterial('R6');
    is(await h.move(m, 'IN', 10, 100, { movementDate: '2024-01-01' }), 201);
    is(await h.move(m, 'IN', 10, 100, { movementDate: '2024-01-03' }), 201);
    const r = await h.move(m, 'OUT', 5, undefined, { movementDate: '2024-01-02' }); is(r, 201);
    const l = (await call('GET', `/movements?material=${m}`, undefined, U)).b;
    assert.deepStrictEqual(l.map((x) => x.balanceAfter), [10, 5, 15]);
    assert.strictEqual(await qty(m), 15);
  });

  await t('back-dated OUT that would make a LATER movement negative is rejected and everything is restored exactly', async () => {
    const m = await h.newMaterial('R7');
    await h.move(m, 'IN', 10, 100, { movementDate: '2024-02-01' });
    await h.move(m, 'OUT', 8, undefined, { movementDate: '2024-02-03' });
    await h.move(m, 'IN', 4, 130, { movementDate: '2024-02-05' });
    const before = await snap(m);
    const r = await h.move(m, 'OUT', 5, undefined, { movementDate: '2024-02-02' }); is(r, 400);
    assert.strictEqual(r.b.message, 'Cannot insert this back-dated OUT: it would make stock negative on 2024-02-03 after replay.');
    assert.strictEqual(await snap(m), before); // every balance / rate / amount, and the material, byte for byte
    assert.strictEqual(await count(m), 3);
  });

  await t('back-dated OUT that is negative at its own point is rejected and restored', async () => {
    const m = await h.newMaterial('R8');
    await h.move(m, 'IN', 10, 100, { movementDate: '2024-03-05' });
    const before = await snap(m);
    const r = await h.move(m, 'OUT', 1, undefined, { movementDate: '2024-03-01' }); is(r, 400);
    assert.strictEqual(await snap(m), before);
  });

  await t('older negative history does not block unrelated back-dated entries, but a new OUT is still refused', async () => {
    const m = await h.newMaterial('R9');
    await Movement.create({ material: m, type: 'OUT', quantity: 5, rate: 0, amount: 0, balanceAfter: -5, exceededStock: true, movementDate: new Date('2024-04-05') });
    await Material.updateOne({ _id: m }, { currentQuantity: -5 });
    is(await h.move(m, 'IN', 1, 10, { movementDate: '2024-04-01' }), 201); // lands before the legacy row; its old negative stays as it was
    const r = await h.move(m, 'OUT', 1); is(r, 400);
    assert.match(r.b.message, /^Cannot record OUT of 1: only 0 /); // a negative balance is never advertised as "available"
  });

  await t('two concurrent OUTs of 8 against stock 10: exactly one wins, the other is refused, stock ends at 2', async () => {
    const m = await h.newMaterial('R10');
    await h.move(m, 'IN', 10, 100);
    const rs = await Promise.all([h.move(m, 'OUT', 8), h.move(m, 'OUT', 8)]);
    assert.deepStrictEqual(rs.map((r) => r.s).sort(), [201, 400]);
    assert.strictEqual(await qty(m), 2);
    assert.strictEqual(await count(m), 2);
  });

  await t('20 concurrent OUTs of 1 against stock 12: exactly 12 succeed', async () => {
    const m = await h.newMaterial('R11');
    await h.move(m, 'IN', 12, 100);
    const rs = await Promise.all(Array.from({ length: 20 }, () => h.move(m, 'OUT', 1)));
    assert.strictEqual(rs.filter((r) => r.s === 201).length, 12);
    assert.strictEqual(rs.filter((r) => r.s === 400).length, 8);
    assert.strictEqual(await qty(m), 0);
  });

  await h.finish();
})();
