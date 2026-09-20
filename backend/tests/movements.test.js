// Phases 4 + 5: movements, costing engine, ledger edit + recalculation
const setup = require('./harness');

(async () => {
  const h = await setup('movements');
  const { t, is, near, call, assert, mongoose } = h;
  const A = h.admin, U = h.user;

  // ================= PHASE 4 brutal =================
  const m1 = await h.newMaterial('MAT001', { unit: 'Bag' });
  const ids = [];
  await t('1. IN 100@400', async () => {
    const r = await h.move(m1, 'IN', 100, 400); is(r, 201);
    assert(r.b.material.currentQuantity === 100 && r.b.material.currentRate === 400);
    assert(r.b.movement.amount === 40000 && r.b.movement.rate === 400 && r.b.movement.enteredRate === 400);
    assert(r.b.movement.balanceAfter === 100 && !r.b.warning);
    ids.push(r.b.movement._id);
  });
  await t('2. IN 50@440: amount is ACTUAL paid (22000), not blended', async () => {
    const r = await h.move(m1, 'IN', 50, 440); is(r, 201);
    assert.strictEqual(r.b.movement.amount, 22000);
    assert.notStrictEqual(r.b.movement.amount, Math.round(50 * 413.3333 * 100) / 100);
    assert.strictEqual(r.b.movement.rate, 440);
    assert.strictEqual(r.b.material.currentQuantity, 150);
    near(r.b.material.currentRate, 413.33);
    assert.strictEqual(r.b.movement.balanceAfter, 150);
  });
  await t('3. OUT 30 at current avg rate', async () => {
    const r = await h.move(m1, 'OUT', 30); is(r, 201);
    assert.strictEqual(r.b.material.currentQuantity, 120);
    near(r.b.material.currentRate, 413.33);
    near(r.b.movement.amount, 30 * 413.333333, 0.005);
    assert.strictEqual(r.b.movement.balanceAfter, 120);
    assert.strictEqual(r.b.movement.exceededStock, false);
  });
  await t('4. RETURN 20 keeps rate', async () => {
    const r = await h.move(m1, 'RETURN', 20); is(r, 201);
    assert.strictEqual(r.b.material.currentQuantity, 140);
    near(r.b.material.currentRate, 413.33);
    near(r.b.movement.rate, 413.33);
    assert.strictEqual(r.b.movement.balanceAfter, 140);
  });
  await t('5. GET ordered, populated, balanceAfter chain', async () => {
    const r = await call('GET', `/movements?material=${m1}`, undefined, U); is(r, 200);
    assert.deepStrictEqual(r.b.map((m) => m.balanceAfter), [100, 150, 120, 140]);
    assert.deepStrictEqual(r.b.map((m) => m.type), ['IN', 'IN', 'OUT', 'RETURN']);
    assert(r.b[0].material.materialId === 'MAT001' && r.b[0].createdBy.name === 'Bob');
    const all = await call('GET', '/movements', undefined, U);
    assert.strictEqual(all.b.length, 4);
  });
  await t('IN into empty stock works (rate = entered)', async () => {
    const m = await h.newMaterial('EMPTY1');
    const r = await h.move(m, 'IN', 10, 55); is(r, 201);
    assert.strictEqual(r.b.material.currentRate, 55);
  });
  await t('opening stock is the baseline for the average', async () => {
    const m = await h.newMaterial('OPEN1', { openingQuantity: 100, openingRate: 400 });
    const r = await h.move(m, 'IN', 50, 440); is(r, 201);
    near(r.b.material.currentRate, 413.33);
  });
  await t('any approved user (not only admin) can post', async () => is(await h.move(m1, 'RETURN', 1, undefined, {}, U), 201));
  await t('admin can post too', async () => is(await h.move(m1, 'RETURN', 1, undefined, {}, A), 201));

  // ================= PHASE 4 break =================
  const m2 = await h.newMaterial('MAT002');
  await h.move(m2, 'IN', 140, 100);
  await t('1. OUT 500 with 140: rejected, nothing recorded, stock untouched', async () => {
    const r = await h.move(m2, 'OUT', 500); is(r, 400);
    assert.strictEqual(r.b.message, 'Cannot record OUT of 500: only 140 Bag available.');
    assert(!r.b.warning && !r.b.movement);
    const g = await call('GET', `/materials/${m2}`, undefined, U);
    assert.strictEqual(g.b.currentQuantity, 140);
    assert.strictEqual((await call('GET', `/movements?material=${m2}`, undefined, U)).b.length, 1);
  });
  await t('OUT of all 140: allowed (equal to stock), balance 0, not flagged', async () => {
    const r = await h.move(m2, 'OUT', 140); is(r, 201);
    assert.strictEqual(r.b.movement.exceededStock, false);
    assert.strictEqual(r.b.movement.balanceAfter, 0);
    assert.strictEqual(r.b.material.status, 'OUT_OF_STOCK');
  });
  await t('IN into an empty material takes the entered rate', async () => {
    const r = await h.move(m2, 'IN', 400, 120); is(r, 201);
    assert.strictEqual(r.b.material.currentQuantity, 400);
    assert.strictEqual(r.b.material.currentRate, 120);
  });
  await t('OUT exactly equal to stock: not exceeded', async () => {
    const r = await h.move(m2, 'OUT', 400); is(r, 201);
    assert.strictEqual(r.b.movement.exceededStock, false);
    assert.strictEqual(r.b.material.currentQuantity, 0);
  });
  await t('2. IN missing rate 400', async () => {
    is(await h.move(m2, 'IN', 5), 400);
    is(await h.move(m2, 'IN', 5, null), 400);
    is(await h.move(m2, 'IN', 5, ''), 400);
    is(await h.move(m2, 'IN', 5, 'abc'), 400);
    is(await h.move(m2, 'IN', 5, -1), 400);
  });
  await t('IN rate 0 allowed (free stock)', async () => is(await h.move(m2, 'IN', 1, 0), 201));
  await t('3. nonexistent material 404', async () => is(await h.move(new mongoose.Types.ObjectId().toString(), 'IN', 1, 1), 404));
  await t('3. inactive material 404', async () => {
    const m = await h.newMaterial('INACT');
    await call('PATCH', `/materials/${m}/deactivate`, undefined, A);
    is(await h.move(m, 'IN', 1, 1), 404);
    await call('PATCH', `/materials/${m}/reactivate`, undefined, A);
    is(await h.move(m, 'IN', 1, 1), 201);
  });
  await t('malformed material id 400', async () => is(await h.move('xyz', 'IN', 1, 1), 400));
  await t('4. quantity 0/negative/non-numeric/missing 400', async () => {
    is(await h.move(m2, 'IN', 0, 5), 400);
    is(await h.move(m2, 'OUT', 0), 400);
    is(await h.move(m2, 'IN', -5, 5), 400);
    is(await h.move(m2, 'OUT', -5), 400);
    is(await h.move(m2, 'RETURN', 'abc'), 400);
    is(await call('POST', '/movements', { material: m2, type: 'IN', rate: 1 }, U), 400);
  });
  await t('bad / missing type 400', async () => {
    is(await h.move(m2, 'MOVE', 1, 1), 400);
    is(await call('POST', '/movements', { material: m2, quantity: 1 }, U), 400);
  });
  await t('bad movementDate 400', async () => is(await h.move(m2, 'IN', 1, 1, { movementDate: 'not-a-date' }), 400));
  await t('unauthenticated 401', async () => is(await call('POST', '/movements', { material: m2, type: 'IN', quantity: 1, rate: 1 }), 401));
  await t('5. OUT/RETURN ignore rate in body', async () => {
    const m = await h.newMaterial('IGN1');
    await h.move(m, 'IN', 100, 400);
    const o = await h.move(m, 'OUT', 10, 9999, { enteredRate: 9999 });
    is(o, 201);
    assert(o.b.movement.rate === 400 && o.b.movement.amount === 4000 && o.b.movement.enteredRate === null);
    const r = await h.move(m, 'RETURN', 5, 1, { enteredRate: 1 });
    is(r, 201);
    assert(r.b.movement.rate === 400 && r.b.movement.amount === 2000 && r.b.material.currentRate === 400);
    const bad = await h.move(m, 'OUT', 1, -50); // junk rate on OUT is ignored, not rejected
    is(bad, 201); assert.strictEqual(bad.b.movement.rate, 400);
  });
  await t('role/status style extra fields ignored (createdBy is the caller)', async () => {
    const r = await h.move(m2, 'RETURN', 1, undefined, { createdBy: new mongoose.Types.ObjectId().toString(), balanceAfter: 999, amount: 1 });
    is(r, 201);
    assert(r.b.movement.balanceAfter !== 999 && r.b.movement.amount !== 1);
    const me = await call('GET', '/auth/me', undefined, U);
    assert.strictEqual(String(r.b.movement.createdBy), me.b.id);
  });
  await t('concurrent INs do not lose updates', async () => {
    const m = await h.newMaterial('CONC1');
    const rs = await Promise.all(Array.from({ length: 10 }, () => h.move(m, 'IN', 10, 10)));
    rs.forEach((r) => is(r, 201));
    const g = await call('GET', `/materials/${m}`, undefined, U);
    assert.strictEqual(g.b.currentQuantity, 100);
    const list = await call('GET', `/movements?material=${m}`, undefined, U);
    assert.deepStrictEqual(list.b.map((x) => x.balanceAfter), [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
  });
  await t('back-dated entry replays later movements', async () => {
    const m = await h.newMaterial('BACK1');
    await h.move(m, 'IN', 100, 400, { movementDate: '2026-01-10' });
    await h.move(m, 'OUT', 30, undefined, { movementDate: '2026-01-20' });
    const r = await h.move(m, 'IN', 100, 500, { movementDate: '2026-01-15' }); is(r, 201);
    const g = await call('GET', `/materials/${m}`, undefined, U);
    assert.strictEqual(g.b.currentQuantity, 170); near(g.b.currentRate, 450);
    const l = await call('GET', `/movements?material=${m}`, undefined, U);
    assert.deepStrictEqual(l.b.map((x) => x.balanceAfter), [100, 200, 170]);
    near(l.b[2].rate, 450);
  });
  await t('GET bad material filter 400', async () => is(await call('GET', '/movements?material=zzz', undefined, U), 400));

  // ================= PHASE 5 brutal: corrections (reversal + corrected entry, original frozen) =================
  const M3 = await h.newMaterial('MAT003');
  const m3 = M3;
  const a = (await h.move(M3, 'IN', 100, 400)).b.movement._id;
  const b = (await h.move(M3, 'IN', 50, 440)).b.movement._id;
  const c = (await h.move(M3, 'OUT', 30)).b.movement._id;
  const ledger = async (m) => (await call('GET', `/movements?material=${m}`, undefined, U)).b;
  const mat = async (m) => (await call('GET', `/materials/${m}`, undefined, U)).b;
  await t('correct FIRST IN qty 100->200: original frozen, reversal OUT 100, corrected IN 200', async () => {
    const r = await call('PUT', `/movements/${a}`, { quantity: 200 }, A); is(r, 200);
    assert(r.b.original.quantity === 100 && r.b.original.amount === 40000 && r.b.original.isEdited === true && r.b.original.lastEditedBy && r.b.original.lastEditedAt);
    assert(r.b.reversal.type === 'OUT' && r.b.reversal.quantity === 100 && r.b.reversal.isReversal === true && r.b.reversal.correctionOf === a);
    assert(r.b.corrected.type === 'IN' && r.b.corrected.quantity === 200 && r.b.corrected.enteredRate === 400 && r.b.corrected.correctionOf === a);
    // 150@413.33 -> OUT30 -> 120 -> reversal OUT100 -> 20 -> corrected IN 200@400: (20*413.333333+200*400)/220
    assert.strictEqual(r.b.material.currentQuantity, 220);
    near(r.b.material.currentRate, (20 * 413.333333 + 200 * 400) / 220, 1e-4);
    const l = await ledger(m3);
    assert.strictEqual(l.length, 5);
    assert.deepStrictEqual(l.map((x) => x.balanceAfter), [100, 150, 120, 20, 220]);
    assert(l[0].quantity === 100 && l[0].rate === 400 && l[0].isEdited === true);
    assert(l[1].isEdited === false && l[1].rate === 440 && l[1].amount === 22000); // untouched
  });
  await t('correct MIDDLE movement rate 440->480: same shape, blended rate follows', async () => {
    const before = await mat(m3);
    const r = await call('PUT', `/movements/${b}`, { enteredRate: 480 }, A); is(r, 200);
    assert.strictEqual(r.b.original.enteredRate, 440);
    assert.strictEqual(r.b.corrected.enteredRate, 480); assert.strictEqual(r.b.corrected.amount, 24000);
    assert.strictEqual(r.b.material.currentQuantity, 220);
    near(r.b.material.currentRate, (170 * before.currentRate + 50 * 480) / 220, 1e-4); // 220 -50 (reversal at avg) +50@480
  });
  await t('correct type OUT->RETURN: reversal IN at the OUT rate, corrected RETURN, no rate kept', async () => {
    const before = await mat(m3);
    const r = await call('PUT', `/movements/${c}`, { type: 'RETURN' }, A); is(r, 200);
    assert(r.b.reversal.type === 'IN' && r.b.reversal.quantity === 30 && r.b.reversal.enteredRate === 413.333333);
    assert.strictEqual(r.b.corrected.type, 'RETURN'); assert.strictEqual(r.b.corrected.enteredRate, null);
    assert.strictEqual(r.b.material.currentQuantity, before.currentQuantity + 60); // +30 (undo OUT) +30 (RETURN)
  });
  await t('correct type RETURN->IN needs a rate; ok with one', async () => {
    const m = await h.newMaterial('RET2');
    await h.move(m, 'IN', 10, 100);
    const ret = (await h.move(m, 'RETURN', 4)).b.movement._id;
    const w = (await ledger(m)).length;
    is(await call('PUT', `/movements/${ret}`, { type: 'IN' }, A), 400);
    assert.strictEqual((await ledger(m)).length, w); // the refusal posted nothing
    const r = await call('PUT', `/movements/${ret}`, { type: 'IN', enteredRate: 500 }, A); is(r, 200);
    assert.strictEqual(r.b.reversal.type, 'OUT'); assert.strictEqual(r.b.corrected.enteredRate, 500);
    assert.strictEqual(r.b.material.currentQuantity, 14);
  });
  await t('a correction dated before any stock existed is refused (would go negative) and nothing changes', async () => {
    const m = await h.newMaterial('REORD');
    await h.move(m, 'IN', 100, 400, { movementDate: '2026-02-01' });
    const out = (await h.move(m, 'OUT', 50, undefined, { movementDate: '2026-02-02' })).b.movement._id;
    const before = JSON.stringify((await ledger(m)).map((x) => [x._id, x.balanceAfter, x.rate, x.amount]));
    const r = await call('PUT', `/movements/${out}`, { movementDate: '2025-12-01' }, A); is(r, 400);
    assert.match(r.b.message, /negative on 2025-12-01/);
    assert.strictEqual(JSON.stringify((await ledger(m)).map((x) => [x._id, x.balanceAfter, x.rate, x.amount])), before);
    assert.strictEqual((await mat(m)).currentQuantity, 50);
  });
  await t('note-only correction still posts the pair; corrected carries the new note', async () => {
    const m = await h.newMaterial('NOTE1');
    const id = (await h.move(m, 'IN', 10, 10)).b.movement._id;
    const r = await call('PUT', `/movements/${id}`, { note: 'fixed typo' }, A); is(r, 200);
    assert.strictEqual(r.b.corrected.note, 'fixed typo');
    assert.strictEqual(r.b.material.currentQuantity, 10);
  });
  await t('correction is audited as MOVEMENT_CORRECTION', async () => {
    assert(await mongoose.models.AuditLog.exists({ action: 'MOVEMENT_CORRECTION' }));
    assert(!(await mongoose.models.AuditLog.exists({ action: 'MOVEMENT_EDIT' })));
  });

  // ================= PHASE 5 break =================
  const fresh = (await h.move(M3, 'IN', 1, 1)).b.movement._id; // never corrected
  await t('negative / zero / non-numeric quantity 400', async () => {
    is(await call('PUT', `/movements/${fresh}`, { quantity: -5 }, A), 400);
    is(await call('PUT', `/movements/${fresh}`, { quantity: 0 }, A), 400);
    is(await call('PUT', `/movements/${fresh}`, { quantity: 'abc' }, A), 400);
  });
  await t('bad type / negative rate / bad date 400', async () => {
    is(await call('PUT', `/movements/${fresh}`, { type: 'XX' }, A), 400);
    is(await call('PUT', `/movements/${fresh}`, { enteredRate: -1 }, A), 400);
    is(await call('PUT', `/movements/${fresh}`, { movementDate: 'nope' }, A), 400);
  });
  await t('rejected corrections left data untouched and the movement still correctable', async () => {
    const q = (await mat(m3)).currentQuantity;
    assert.strictEqual((await Promise.resolve(mongoose.models.Movement.findById(fresh))).isEdited, false);
    is(await call('PUT', `/movements/${fresh}`, { quantity: 0 }, A), 400);
    assert.strictEqual((await mat(m3)).currentQuantity, q);
  });
  await t('nonexistent id 404, malformed id 400', async () => {
    is(await call('PUT', `/movements/${new mongoose.Types.ObjectId()}`, { quantity: 1 }, A), 404);
    is(await call('PUT', '/movements/xyz', { quantity: 1 }, A), 400);
  });
  await t('non-admin 403, no token 401', async () => {
    is(await call('PUT', `/movements/${fresh}`, { quantity: 1 }, U), 403);
    is(await call('PUT', `/movements/${fresh}`, { quantity: 1 }), 401);
  });
  await t('correcting with the same values posts a neutral pair; a second correction of the same original is refused', async () => {
    const m = await h.newMaterial('NOOP1');
    await h.move(m, 'IN', 100, 400);
    const out = (await h.move(m, 'OUT', 30)).b.movement._id;
    const before = await mat(m);
    const r = await call('PUT', `/movements/${out}`, { quantity: 30, type: 'OUT' }, A); is(r, 200);
    assert(r.b.material.currentQuantity === before.currentQuantity && r.b.material.currentRate === before.currentRate);
    is(await call('PUT', `/movements/${out}`, {}, A), 400);
  });
  await t('correction that would make stock negative is refused (was: allowed + flagged)', async () => {
    const m = await h.newMaterial('NEG1');
    const inn = (await h.move(m, 'IN', 100, 10)).b.movement._id;
    await h.move(m, 'OUT', 80);
    const r = await call('PUT', `/movements/${inn}`, { quantity: 50 }, A); is(r, 400);
    assert.strictEqual((await mat(m)).currentQuantity, 20);
    assert.strictEqual((await ledger(m)).length, 2);
  });
  await t('correction cannot change material, balance, amount or author directly', async () => {
    const m = await h.newMaterial('OTHER2');
    const other = await h.newMaterial('OTHER1');
    const id = (await h.move(m, 'IN', 5, 10)).b.movement._id;
    const r = await call('PUT', `/movements/${id}`, { material: other, amount: 1, balanceAfter: 1, createdBy: other }, A); is(r, 200);
    assert(String(r.b.corrected.material) === m && r.b.corrected.amount !== 1 && r.b.corrected.balanceAfter !== 1 && r.b.corrected.createdBy !== other);
    assert.strictEqual((await ledger(other)).length, 0);
  });

  await h.finish();
})().catch((e) => { console.error('harness error:', e); process.exit(1); });
