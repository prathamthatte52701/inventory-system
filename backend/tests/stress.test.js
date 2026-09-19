// Multi-user load: 1 admin + 4 normal users hammer the read endpoints on a large history while writes are in flight.
// Not part of `npm test` (it is slow against a remote DB): run with `npm run stress`.
process.env.TEST_DB = 'inventory_test_stress';
const setup = require('./harness');
const Movement = require('../models/Movement');
const Material = require('../models/Material');

const N_MATERIALS = 20, PER_MATERIAL = 300; // 6000 seeded movements
const DAY = 864e5;
const pct = (a, p) => [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))];

(async () => {
  const h = await setup('stress');
  const { t, is, call, assert } = h;
  const lat = []; // every timed request
  const timed = async (...args) => { const t0 = Date.now(); try { const r = await call(...args); lat.push(Date.now() - t0); return r; } catch (e) { throw new Error(`${args[0]} ${args[1]} failed after ${Date.now() - t0}ms: ${e.message} ${e.cause ? e.cause.message : ''}`); } };

  // ---- users ----
  const users = [{ name: 'admin', tok: h.admin }, { name: 'bob', tok: h.user }];
  for (const n of ['carol', 'dave', 'erin']) {
    const su = await call('POST', '/auth/signup', { name: n, email: `${n}@test.com`, password: 'secret1' });
    await call('PATCH', `/users/${su.b.id}/approve`, undefined, h.admin);
    users.push({ name: n, tok: (await call('POST', '/auth/login', { email: `${n}@test.com`, password: 'secret1' })).token });
  }
  const bobId = (await call('GET', '/auth/me', undefined, h.user)).b.id;

  // ---- big history, inserted directly (state kept consistent: IN qty 1 @ 10) ----
  const mats = await Material.insertMany(Array.from({ length: N_MATERIALS }, (_, i) => ({ materialId: `ST${String(i).padStart(2, '0')}`, description: `Stress ${i}`, unit: 'u', currentQuantity: PER_MATERIAL, currentRate: 10 })));
  const t0 = Date.now() - PER_MATERIAL * DAY;
  await Movement.insertMany(mats.flatMap((m) => Array.from({ length: PER_MATERIAL }, (_, i) => ({
    material: m._id, type: 'IN', quantity: 1, rate: 10, enteredRate: 10, amount: 10, balanceAfter: i + 1, movementDate: new Date(t0 + i * DAY), createdBy: bobId,
  }))), { ordered: false });
  const TOTAL = N_MATERIALS * PER_MATERIAL;
  console.log(`  seeded ${TOTAL} movements over ${N_MATERIALS} materials`);

  // ---- 1: every user pages through the WHOLE ledger of a material, concurrently ----
  await t('5 users concurrently walk every page of different materials: no dup/missing rows, ordered, consistent totals', async () => {
    await Promise.all(users.map(async (u, k) => {
      for (const m of [mats[k * 2], mats[k * 2 + 1]]) {
        const seen = new Set();
        let last = -1, page = 1, totalPages = 1;
        do {
          const r = await timed('GET', `/movements?material=${m._id}&page=${page}&limit=100`, undefined, u.tok);
          is(r, 200);
          totalPages = r.b.totalPages;
          assert.strictEqual(r.b.total, PER_MATERIAL);
          for (const mv of r.b.data) {
            assert(!seen.has(mv._id), 'duplicate row across pages');
            seen.add(mv._id);
            assert(mv.balanceAfter > last, 'out of order'); last = mv.balanceAfter;
          }
        } while (++page <= totalPages);
        assert.strictEqual(seen.size, PER_MATERIAL, `${u.name} saw ${seen.size}`);
      }
    }));
  });

  // ---- 2: mixed read storm ----
  await t('mixed read storm: 5 users x (materials, dashboard, ledger pages, excel/pdf exports); admin also audit + analytics', async () => {
    const bad = [];
    const one = async (u, ...a) => { const r = await timed(...a, u.tok); if (r.s !== 200) bad.push(`${u.name} ${a[1]} -> ${r.s}`); return r; };
    await Promise.all(users.flatMap((u) => [
      ...Array.from({ length: 6 }, (_, i) => one(u, 'GET', `/movements?page=${i + 1}&limit=200`, undefined)),
      one(u, 'GET', '/materials', undefined), one(u, 'GET', '/reports/dashboard', undefined),
      timed('GET', '/reports/stock-value/excel', undefined, u.tok, true).then((r) => { if (r.s !== 200 || r.buf.length < 1000) bad.push(`${u.name} excel ${r.s}`); }),
      timed('GET', '/reports/stock-value/pdf', undefined, u.tok, true).then((r) => { if (r.s !== 200 || r.buf.length < 500) bad.push(`${u.name} pdf ${r.s}`); }),
      timed('GET', '/reports/movements/excel', undefined, u.tok, true).then((r) => { if (r.s !== 200 || r.buf.length < 10000) bad.push(`${u.name} movements excel ${r.s} ${r.buf.length}B`); }),
      ...(u.name === 'admin' ? [
        one(u, 'GET', '/audit?limit=200', undefined), one(u, 'GET', '/analytics/volume?bucket=week&from=2018-01-01&to=2026-12-31', undefined),
        one(u, 'GET', '/analytics/top-materials?limit=20&from=2020-01-01', undefined),
      ] : [
        timed('GET', '/audit', undefined, u.tok).then((r) => { if (r.s !== 403) bad.push(`${u.name} audit ${r.s}`); }),
        timed('GET', '/analytics/volume', undefined, u.tok).then((r) => { if (r.s !== 403) bad.push(`${u.name} analytics ${r.s}`); }),
      ]),
    ]));
    assert.deepStrictEqual(bad, []);
  });

  // ---- 3: writes racing reads on one shared material ----
  await t('concurrent writes from 5 users on one material while others read: final balance equals the sum of all writes', async () => {
    const target = mats[19];
    const start = (await Material.findById(target._id)).currentQuantity;
    const writes = [];
    users.forEach((u, k) => {
      for (let i = 0; i < 6; i++) writes.push(call('POST', '/movements', k % 2 ? { material: String(target._id), type: 'OUT', quantity: 2 } : { material: String(target._id), type: 'IN', quantity: 3, rate: 12 }, u.tok));
    });
    const reads = users.map((u) => timed('GET', `/movements?material=${target._id}&page=1&limit=50`, undefined, u.tok));
    const results = await Promise.all([...writes, ...reads]);
    results.forEach((r) => assert(r.s === 200 || r.s === 201, `status ${r.s} ${JSON.stringify(r.b)}`));
    const inQty = 3 * 6 * users.filter((_, k) => k % 2 === 0).length, outQty = 2 * 6 * users.filter((_, k) => k % 2 === 1).length;
    const m = await Material.findById(target._id);
    assert.strictEqual(m.currentQuantity, start + inQty - outQty);
    const all = await Movement.find({ material: target._id }).sort({ movementDate: 1, createdAt: 1, _id: 1 }).lean();
    assert.strictEqual(all.length, PER_MATERIAL + 30);
    assert.strictEqual(all[all.length - 1].balanceAfter, m.currentQuantity, 'last ledger balance must equal material balance');
    let run = 0; for (const mv of all) { run += mv.type === 'IN' ? mv.quantity : -mv.quantity; assert.strictEqual(mv.balanceAfter, run, 'running balance broke'); }
  });

  // ---- 4: audit trail saw those writes, admin can page it ----
  await t('audit log recorded all 30 concurrent writes and pages consistently', async () => {
    const r = await call('GET', '/audit?action=MOVEMENT_CREATE&limit=10', undefined, h.admin);
    is(r, 200); assert.strictEqual(r.b.total, 30);
    const ids = new Set();
    for (let p = 1; p <= r.b.totalPages; p++) (await call('GET', `/audit?action=MOVEMENT_CREATE&limit=10&page=${p}`, undefined, h.admin)).b.data.forEach((a) => ids.add(a._id));
    assert.strictEqual(ids.size, 30);
  });

  await t('analytics over the full history is aggregated and small', async () => {
    const r = await call('GET', '/analytics/volume?from=2018-01-01&to=2026-12-31&bucket=week', undefined, h.admin);
    is(r, 200);
    assert(r.b.totals.IN.count >= TOTAL, `IN count ${r.b.totals.IN.count}`);
    assert(JSON.stringify(r.b).length < 100000);
  });

  console.log(`  ${lat.length} timed requests: p50 ${pct(lat, 0.5)}ms  p95 ${pct(lat, 0.95)}ms  max ${Math.max(...lat)}ms`);
  await h.finish();
})();
