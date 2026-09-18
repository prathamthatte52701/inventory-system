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
  await t('1. OUT 500 with 140: allowed, negative stock, warning', async () => {
    const r = await h.move(m2, 'OUT', 500); is(r, 201);
    assert.strictEqual(r.b.material.currentQuantity, -360);
    assert.strictEqual(r.b.movement.exceededStock, true);
    assert.strictEqual(r.b.movement.balanceAfter, -360);
    assert(typeof r.b.warning === 'string' && r.b.warning.length > 0);
    assert.strictEqual(r.b.material.status, 'OUT_OF_STOCK');
  });
  await t('IN after negative stock resets to entered rate, not garbage', async () => {
    const r = await h.move(m2, 'IN', 400, 120); is(r, 201);
    assert.strictEqual(r.b.material.currentQuantity, 40);
    assert.strictEqual(r.b.material.currentRate, 120);
  });
  await t('OUT exactly equal to stock: not exceeded', async () => {
    const r = await h.move(m2, 'OUT', 40); is(r, 201);
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

  // ================= PHASE 5 brutal =================
  const m3 = await h.newMaterial('MAT003');
  const a = (await h.move(m3, 'IN', 100, 400)).b.movement._id;
  const b = (await h.move(m3, 'IN', 50, 440)).b.movement._id;
  const c = (await h.move(m3, 'OUT', 30)).b.movement._id;
  await t('edit FIRST IN qty 100->200 cascades', async () => {
    const r = await call('PUT', `/movements/${a}`, { quantity: 200 }, A); is(r, 200);
    assert(r.b.movement.quantity === 200 && r.b.movement.rate === 400 && r.b.movement.amount === 80000);
    assert(r.b.movement.isEdited === true && r.b.movement.lastEditedBy && r.b.movement.lastEditedAt);
    assert.strictEqual(r.b.material.currentQuantity, 220);
    assert.strictEqual(r.b.material.currentRate, 408);
    const l = (await call('GET', `/movements?material=${m3}`, undefined, U)).b;
    assert.deepStrictEqual(l.map((x) => x.balanceAfter), [200, 250, 220]);
    assert(l[1].rate === 440 && l[1].amount === 22000 && l[1].isEdited === false);
    assert(l[2].rate === 408 && l[2].amount === 12240 && l[2].balanceAfter === 220);
  });
  await t('edit MIDDLE movement rate', async () => {
    const r = await call('PUT', `/movements/${b}`, { enteredRate: 480 }, A); is(r, 200);
    // (200*400 + 50*480)/250 = 416
    assert.strictEqual(r.b.material.currentRate, 416);
    assert.strictEqual(r.b.movement.amount, 24000);
    const l = (await call('GET', `/movements?material=${m3}`, undefined, U)).b;
    assert(l[2].rate === 416 && l[2].amount === 12480);
  });
  await t('edit type OUT->RETURN cascades', async () => {
    const r = await call('PUT', `/movements/${c}`, { type: 'RETURN' }, A); is(r, 200);
    assert.strictEqual(r.b.material.currentQuantity, 280);
    assert.strictEqual(r.b.movement.enteredRate, null);
  });
  await t('edit type RETURN->IN needs rate; ok with rate', async () => {
    is(await call('PUT', `/movements/${c}`, { type: 'IN' }, A), 400);
    const r = await call('PUT', `/movements/${c}`, { type: 'IN', enteredRate: 500 }, A); is(r, 200);
    assert.strictEqual(r.b.material.currentQuantity, 280);
  });
  await t('edit movementDate reorders chain', async () => {
    const m = await h.newMaterial('REORD');
    await h.move(m, 'IN', 100, 400, { movementDate: '2026-02-01' });
    const out = (await h.move(m, 'OUT', 50, undefined, { movementDate: '2026-02-02' })).b.movement._id;
    const r = await call('PUT', `/movements/${out}`, { movementDate: '2025-12-01' }, A); is(r, 200);
    assert.strictEqual(r.b.movement.exceededStock, true); // now precedes any stock
    assert.strictEqual(r.b.movement.balanceAfter, -50);
    assert.strictEqual(r.b.material.currentQuantity, 50);
    assert.strictEqual(r.b.material.currentRate, 400);
  });
  await t('edit note only marks edited', async () => {
    const r = await call('PUT', `/movements/${a}`, { note: 'fixed typo' }, A); is(r, 200);
    assert.strictEqual(r.b.movement.note, 'fixed typo');
  });
  await t('edit is audited', async () => assert(await mongoose.models.AuditLog.exists({ action: 'MOVEMENT_EDIT' })));

  // ================= PHASE 5 break =================
  await t('negative / zero / non-numeric quantity 400', async () => {
    is(await call('PUT', `/movements/${a}`, { quantity: -5 }, A), 400);
    is(await call('PUT', `/movements/${a}`, { quantity: 0 }, A), 400);
    is(await call('PUT', `/movements/${a}`, { quantity: 'abc' }, A), 400);
  });
  await t('bad type / negative rate / bad date 400', async () => {
    is(await call('PUT', `/movements/${a}`, { type: 'XX' }, A), 400);
    is(await call('PUT', `/movements/${a}`, { enteredRate: -1 }, A), 400);
    is(await call('PUT', `/movements/${a}`, { movementDate: 'nope' }, A), 400);
  });
  await t('rejected edits left data untouched', async () => {
    const g = await call('GET', `/materials/${m3}`, undefined, U);
    assert.strictEqual(g.b.currentQuantity, 280);
  });
  await t('nonexistent id 404, malformed id 400', async () => {
    is(await call('PUT', `/movements/${new mongoose.Types.ObjectId()}`, { quantity: 1 }, A), 404);
    is(await call('PUT', '/movements/xyz', { quantity: 1 }, A), 400);
  });
  await t('non-admin 403, no token 401', async () => {
    is(await call('PUT', `/movements/${a}`, { quantity: 1 }, U), 403);
    is(await call('PUT', `/movements/${a}`, { quantity: 1 }), 401);
  });
  await t('no-op edit (same values) runs cleanly, stays not-edited', async () => {
    const m = await h.newMaterial('NOOP1');
    const id = (await h.move(m, 'IN', 100, 400)).b.movement._id;
    await h.move(m, 'OUT', 30);
    const before = (await call('GET', `/materials/${m}`, undefined, U)).b;
    const r = await call('PUT', `/movements/${id}`, { quantity: 100, type: 'IN', enteredRate: 400 }, A); is(r, 200);
    assert.strictEqual(r.b.movement.isEdited, false);
    const empty = await call('PUT', `/movements/${id}`, {}, A); is(empty, 200);
    assert(r.b.material.currentQuantity === before.currentQuantity && r.b.material.currentRate === before.currentRate);
  });
  await t('edit that makes stock negative is allowed + flagged', async () => {
    const m = await h.newMaterial('NEG1');
    const inn = (await h.move(m, 'IN', 100, 10)).b.movement._id;
    await h.move(m, 'OUT', 80);
    const r = await call('PUT', `/movements/${inn}`, { quantity: 50 }, A); is(r, 200);
    assert.strictEqual(r.b.material.currentQuantity, -30);
    const l = (await call('GET', `/movements?material=${m}`, undefined, U)).b;
    assert.strictEqual(l[1].exceededStock, true);
  });
  await t('edit cannot change material or balance/amount directly', async () => {
    const other = await h.newMaterial('OTHER1');
    const r = await call('PUT', `/movements/${a}`, { material: other, amount: 1, balanceAfter: 1, createdBy: other }, A); is(r, 200);
    assert(String(r.b.movement.material) === m3 && r.b.movement.amount !== 1);
  });

  await h.finish();
})().catch((e) => { console.error('harness error:', e); process.exit(1); });
