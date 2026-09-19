// Admin section backend: GET /audit (filters + pagination), GET /analytics/*, GET /users/:id/activity.
process.env.TEST_DB = 'inventory_test_admin';
const setup = require('./harness');
const Movement = require('../models/Movement');
const AuditLog = require('../models/AuditLog');
const Material = require('../models/Material');

const DAY = 864e5;
const iso = (d) => new Date(d).toISOString().slice(0, 10);

(async () => {
  const h = await setup('admin');
  const { t, is, call, assert, near } = h;
  const me = (tok) => call('GET', '/auth/me', undefined, tok).then((r) => r.b);
  const admin = await me(h.admin), bob = await me(h.user);
  const bobId = bob.id, adminId = admin.id;

  // ---------- auth: nothing leaks to non-admins ----------
  const guarded = ['/audit', '/analytics/volume', '/analytics/top-materials', `/users/${bobId}/activity`];
  for (const p of guarded) {
    await t(`non-admin gets 403 on GET ${p}`, async () => { const r = await call('GET', p, undefined, h.user); is(r, 403); assert.strictEqual(r.b.data, undefined); assert.strictEqual(r.b.buckets, undefined); });
    await t(`no session gets 401 on GET ${p}`, async () => is(await call('GET', p), 401));
    await t(`admin gets 200 on GET ${p}`, async () => is(await call('GET', p, undefined, h.admin), 200));
  }

  // ---------- audit log ----------
  await t('audit: real actions are readable, newest first, envelope shape', async () => {
    const r = await call('GET', '/audit', undefined, h.admin);
    is(r, 200);
    assert.deepStrictEqual(Object.keys(r.b).sort(), ['data', 'limit', 'page', 'total', 'totalPages']);
    assert(r.b.total >= 3 && r.b.data.length === Math.min(r.b.total, 50));
    for (let i = 1; i < r.b.data.length; i++) assert(new Date(r.b.data[i - 1].createdAt) >= new Date(r.b.data[i].createdAt), 'not newest first');
    assert(r.b.data.some((a) => a.action === 'LOGIN'));
  });

  const mk = (n, extra = {}, base = Date.now()) => AuditLog.insertMany(Array.from({ length: n }, (_, i) => ({
    action: 'TEST_ACT', entityType: 'TestE', user: adminId, userEmail: 'a@x', createdAt: new Date(base - i * 1000), ...extra,
  })));
  await mk(5);
  await t('audit boundary: exactly limit rows = 1 page', async () => {
    const r = await call('GET', '/audit?entityType=TestE&limit=5', undefined, h.admin);
    is(r, 200); assert.deepStrictEqual([r.b.total, r.b.totalPages, r.b.data.length, r.b.page, r.b.limit], [5, 1, 5, 1, 5]);
    const p2 = await call('GET', '/audit?entityType=TestE&limit=5&page=2', undefined, h.admin);
    is(p2, 200); assert.deepStrictEqual([p2.b.data.length, p2.b.totalPages], [0, 1]);
  });
  await mk(1, {}, Date.now() - 999999);
  await t('audit boundary: limit+1 rows -> page 2 has exactly 1 row', async () => {
    const r = await call('GET', '/audit?entityType=TestE&limit=5', undefined, h.admin);
    assert.deepStrictEqual([r.b.total, r.b.totalPages, r.b.data.length], [6, 2, 5]);
    const p2 = await call('GET', '/audit?entityType=TestE&limit=5&page=2', undefined, h.admin);
    assert.strictEqual(p2.b.data.length, 1);
    const ids = new Set([...r.b.data, ...p2.b.data].map((x) => x._id));
    assert.strictEqual(ids.size, 6, 'pages overlap or skip rows');
    const p3 = await call('GET', '/audit?entityType=TestE&limit=5&page=3', undefined, h.admin);
    is(p3, 200); assert.strictEqual(p3.b.data.length, 0);
  });
  await t('audit filters: action, user, entityType combine (AND)', async () => {
    await mk(2, { action: 'OTHER_ACT', entityType: 'TestE', user: bobId });
    const a = await call('GET', '/audit?entityType=TestE&action=OTHER_ACT', undefined, h.admin);
    assert.strictEqual(a.b.total, 2);
    const u = await call('GET', `/audit?entityType=TestE&user=${bobId}`, undefined, h.admin);
    assert.strictEqual(u.b.total, 2);
    const both = await call('GET', `/audit?entityType=TestE&action=TEST_ACT&user=${bobId}`, undefined, h.admin);
    assert.strictEqual(both.b.total, 0);
    const none = await call('GET', '/audit?entityType=Nope', undefined, h.admin);
    assert.deepStrictEqual([none.b.total, none.b.totalPages, none.b.data.length], [0, 0, 0]);
  });
  await t('audit date range: from/to inclusive by day, to covers the whole day', async () => {
    await AuditLog.insertMany([
      { action: 'DR', entityType: 'DateE', createdAt: new Date('2025-03-10T00:00:00Z') },
      { action: 'DR', entityType: 'DateE', createdAt: new Date('2025-03-10T23:59:59Z') },
      { action: 'DR', entityType: 'DateE', createdAt: new Date('2025-03-11T00:00:00Z') },
      { action: 'DR', entityType: 'DateE', createdAt: new Date('2025-03-09T23:59:59Z') },
    ]);
    const q = async (s) => (await call('GET', `/audit?entityType=DateE${s}`, undefined, h.admin)).b.total;
    assert.strictEqual(await q('&from=2025-03-10&to=2025-03-10'), 2);
    assert.strictEqual(await q('&from=2025-03-10'), 3);
    assert.strictEqual(await q('&to=2025-03-10'), 3);
    assert.strictEqual(await q('&from=2025-03-10T00:00:00Z&to=2025-03-11'), 3);
  });
  await t('audit bad params are 400, never partial data or 500', async () => {
    for (const q of ['page=0', 'page=-1', 'page=1.5', 'page=abc', 'limit=0', 'limit=abc', 'limit=1e3', 'user=xyz', 'from=garbage', 'to=2025-13-45', 'from=2025-05-02&to=2025-05-01',
      'action=', 'action=a&action=b', 'from=1960-01-01']) {
      const r = await call('GET', '/audit?' + q, undefined, h.admin);
      assert.strictEqual(r.s, 400, `${q} -> ${r.s}`);
    }
  });
  await t('audit: bracket operators are not parsed (express simple query parser) so cannot inject; the param is just ignored', async () => {
    const all = (await call('GET', '/audit?entityType=TestE', undefined, h.admin)).b.total;
    const r = await call('GET', '/audit?entityType[$ne]=TestE', undefined, h.admin);
    is(r, 200); assert(r.b.total > all, 'operator must not be interpreted');
    is(await call('GET', '/audit?user[$ne]=1', undefined, h.admin), 200);
  });
  await t('audit limit above max is clamped to 200', async () => {
    const r = await call('GET', '/audit?limit=99999', undefined, h.admin);
    is(r, 200); assert.strictEqual(r.b.limit, 200);
  });

  // ---------- analytics ----------
  const mat = await Material.create({ materialId: 'AN1', description: 'Alpha', unit: 'Bag' });
  const mat2 = await Material.create({ materialId: 'AN2', description: 'Beta', unit: 'Kg' });
  const mv = (material, type, quantity, amount, date, by = bobId) => ({ material, type, quantity, rate: amount / quantity, amount, balanceAfter: 0, movementDate: new Date(date), createdBy: by });
  const today = iso(Date.now());
  const d = (n) => iso(Date.now() - n * DAY);
  await Movement.insertMany([
    mv(mat._id, 'IN', 10, 100, d(2) + 'T10:00:00Z'), mv(mat._id, 'IN', 5, 50, d(2) + 'T23:59:00Z'), mv(mat._id, 'OUT', 3, 30, d(2) + 'T12:00:00Z'),
    mv(mat2._id, 'OUT', 100, 1000, d(1) + 'T08:00:00Z'), mv(mat2._id, 'RETURN', 1, 10, today + 'T00:00:01Z'),
    mv(mat._id, 'IN', 1, 1, d(45) + 'T08:00:00Z'), // outside the default 30-day window
  ]);

  await t('volume: default range is last 30 days, bucketed by day with per-type sums', async () => {
    const r = await call('GET', '/analytics/volume', undefined, h.admin);
    is(r, 200);
    assert.strictEqual(r.b.bucket, 'day'); assert.strictEqual(r.b.to, today); assert.strictEqual(r.b.from, d(29));
    assert.deepStrictEqual(r.b.buckets.map((b) => b.bucket), [d(2), d(1), today]);
    const b2 = r.b.buckets[0];
    assert.deepStrictEqual(b2.IN, { count: 2, quantity: 15, amount: 150 });
    assert.deepStrictEqual(b2.OUT, { count: 1, quantity: 3, amount: 30 });
    assert.strictEqual(b2.RETURN, undefined);
    assert.deepStrictEqual(r.b.totals.IN, { count: 2, quantity: 15, amount: 150 });
    assert.deepStrictEqual(r.b.totals.OUT, { count: 2, quantity: 103, amount: 1030 });
    assert.deepStrictEqual(r.b.totals.RETURN, { count: 1, quantity: 1, amount: 10 });
  });
  await t('volume: explicit range includes older movements; day boundaries are inclusive', async () => {
    const r = await call('GET', `/analytics/volume?from=${d(45)}&to=${d(45)}`, undefined, h.admin);
    assert.strictEqual(r.b.totals.IN.count, 1);
    const r2 = await call('GET', `/analytics/volume?from=${d(2)}&to=${d(2)}`, undefined, h.admin);
    assert.strictEqual(r2.b.totals.IN.count, 2); // 23:59 of the last day still counted
  });
  await t('volume: weekly buckets start on Monday and merge days', async () => {
    const r = await call('GET', `/analytics/volume?from=${d(45)}&to=${today}&bucket=week`, undefined, h.admin);
    is(r, 200);
    for (const b of r.b.buckets) assert.strictEqual(new Date(b.bucket).getUTCDay(), 1, `${b.bucket} not a Monday`);
    assert.strictEqual(r.b.buckets.reduce((n, b) => n + (b.IN ? b.IN.count : 0), 0), 3);
    assert(r.b.buckets.length <= 3);
  });
  await t('volume: empty range = empty buckets and zero totals, still 200', async () => {
    const r = await call('GET', '/analytics/volume?from=2001-01-01&to=2001-01-31', undefined, h.admin);
    is(r, 200); assert.deepStrictEqual(r.b.buckets, []);
    assert.deepStrictEqual(r.b.totals.IN, { count: 0, quantity: 0, amount: 0 });
  });
  await t('volume/top: bad params are 400', async () => {
    for (const p of ['volume?from=x', 'volume?to=2025-02-30x', 'volume?from=2025-05-02&to=2025-05-01', 'volume?bucket=month', 'volume?from=1970-01-01&to=2100-12-31', 'top-materials?limit=0', 'top-materials?limit=51', 'top-materials?limit=x', 'top-materials?by=price', 'top-materials?to=nope']) {
      const r = await call('GET', '/analytics/' + p, undefined, h.admin);
      assert.strictEqual(r.s, 400, `${p} -> ${r.s}`);
    }
  });

  await t('top-materials: ranked by value with material details; limit and by=quantity respected', async () => {
    const r = await call('GET', '/analytics/top-materials', undefined, h.admin);
    is(r, 200);
    assert.deepStrictEqual(r.b.data.map((x) => x.materialId), ['AN2', 'AN1']);
    assert.deepStrictEqual(r.b.data[0], { material: String(mat2._id), materialId: 'AN2', description: 'Beta', unit: 'Kg', movements: 2, quantity: 101, amount: 1010 });
    assert.strictEqual(r.b.data[1].movements, 3); // the 45-day-old movement is outside the window
    assert.strictEqual((await call('GET', '/analytics/top-materials?limit=1', undefined, h.admin)).b.data.length, 1);
    const q = await call('GET', '/analytics/top-materials?by=quantity', undefined, h.admin);
    assert.strictEqual(q.b.data[0].materialId, 'AN2');
    const wide = await call('GET', `/analytics/top-materials?from=${d(60)}&to=${today}&by=quantity`, undefined, h.admin);
    assert.strictEqual(wide.b.data.find((x) => x.materialId === 'AN1').movements, 4);
  });
  await t('top-materials: empty period -> empty list', async () => {
    const r = await call('GET', '/analytics/top-materials?from=2001-01-01&to=2001-01-02', undefined, h.admin);
    is(r, 200); assert.deepStrictEqual(r.b.data, []);
  });

  await t('volume + top-materials on a large history: aggregated, small payload, fast', async () => {
    const big = await Material.insertMany(Array.from({ length: 30 }, (_, i) => ({ materialId: `BIG${i}`, description: 'b', unit: 'u' })));
    const docs = [];
    for (let i = 0; i < 4000; i++) docs.push(mv(big[i % 30]._id, ['IN', 'OUT', 'RETURN'][i % 3], 1 + (i % 7), 10 + (i % 5), Date.now() - (i % 400) * DAY));
    await Movement.insertMany(docs, { ordered: false });
    const t0 = Date.now();
    const v = await call('GET', `/analytics/volume?from=${d(500)}&to=${today}`, undefined, h.admin);
    const top = await call('GET', `/analytics/top-materials?from=${d(500)}&to=${today}&limit=10`, undefined, h.admin);
    const ms = Date.now() - t0;
    is(v, 200); is(top, 200);
    assert(ms < 8000, `took ${ms}ms`);
    assert(v.b.buckets.length <= 401 && v.b.buckets.length > 300, `${v.b.buckets.length} buckets`);
    assert.strictEqual(v.b.totals.IN.count + v.b.totals.OUT.count + v.b.totals.RETURN.count, 4000 + 6);
    assert(JSON.stringify(v.b).length < 200000, 'payload too large');
    assert.strictEqual(top.b.data.length, 10);
    assert(JSON.stringify(top.b).length < 5000);
    assert(top.b.data.every((x, i, a) => i === 0 || a[i - 1].amount >= x.amount), 'not sorted desc');
    const w = await call('GET', '/analytics/volume?bucket=week&from=' + d(500) + '&to=' + today, undefined, h.admin);
    assert(w.b.buckets.length < 75);
    console.log(`  (analytics on ~4000 movements: ${ms}ms, volume payload ${JSON.stringify(v.b).length}B, ${v.b.buckets.length} buckets)`);
  });

  // ---------- user activity ----------
  await t('users/:id/activity: counts movements created by that user only', async () => {
    const r = await call('GET', `/users/${bobId}/activity`, undefined, h.admin);
    is(r, 200); assert.strictEqual(r.b.movementCount, 4006); assert(r.b.lastMovementAt);
    const a = await call('GET', `/users/${adminId}/activity`, undefined, h.admin);
    assert.deepStrictEqual(a.b, { movementCount: 0, lastMovementAt: null });
  });
  await t('users/:id/activity: bad / unknown id', async () => {
    is(await call('GET', '/users/nope/activity', undefined, h.admin), 400);
    is(await call('GET', '/users/aaaaaaaaaaaaaaaaaaaaaaaa/activity', undefined, h.admin), 404);
  });

  await h.finish();
})();
