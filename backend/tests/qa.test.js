// Adversarial QA: spec compliance (PDF), security abuse, concurrency, data integrity under chaos.
// Uses its own DB name so it can run beside other suites.
process.env.TEST_DB = 'inventory_test_qa';
const jwt = require('jsonwebtoken');
const ExcelJS = require('exceljs');
const setup = require('./harness');
const pdfText = require('./pdfText');
const Material = require('../models/Material');
const Movement = require('../models/Movement');

let unhandled = 0;
process.on('unhandledRejection', () => { unhandled++; });
process.on('uncaughtException', (e) => { unhandled++; console.log('UNCAUGHT', e.message); });

// ---------- independent oracle: re-derives every number from opening stock + the ordered movements ----------
const sorted = (ms) => [...ms].sort((a, b) => +new Date(a.movementDate) - +new Date(b.movementDate) || +new Date(a.createdAt) - +new Date(b.createdAt) || (a._id < b._id ? -1 : 1));
function oracle(opening, ms) {
  let qty = opening.qty, rate = opening.rate;
  const rows = [];
  for (const m of ms) {
    let r, amt, ex = false;
    if (m.type === 'IN') { r = m.enteredRate; rate = qty <= 0 ? r : (qty * rate + m.quantity * r) / (qty + m.quantity); qty += m.quantity; amt = m.quantity * r; }
    else if (m.type === 'OUT') { r = rate; ex = m.quantity > qty; qty -= m.quantity; amt = m.quantity * r; }
    else { r = rate; qty += m.quantity; amt = m.quantity * r; }
    rows.push({ rate: r, amount: amt, bal: qty, ex });
  }
  return { rows, qty, rate };
}

(async () => {
  const h = await setup('qa');
  const { t, is, call, assert, near, mongoose } = h;
  const A = h.admin, U = h.user;
  const bobId = String((await h.User.findOne({ email: 'bob@test.com' }))._id);
  const adminId = String((await h.User.findOne({ role: 'admin' }))._id);
  const raw = (method, path, { headers = {}, body } = {}) => fetch(h.base + path, { method, headers, body }).then(async (r) => {
    let b = null; try { b = await r.json(); } catch { /* not json */ }
    return { s: r.status, b, headers: r.headers };
  });
  const ok5 = (r, label) => assert(r.s < 500, `${label}: server error ${r.s} ${JSON.stringify(r.b)}`);
  const inChunks = async (items, fn, n = 8) => { const out = []; for (let i = 0; i < items.length; i += n) out.push(...await Promise.all(items.slice(i, i + n).map(fn))); return out; };

  // ============================================================ ROUND 1: spec compliance
  await t('R1 §2 Material Master fields: exist with right type/constraints', () => {
    const p = (k) => Material.schema.path(k);
    assert(p('materialId').instance === 'String' && p('materialId').options.unique && p('materialId').options.uppercase && p('materialId').isRequired);
    assert(p('description').instance === 'String' && p('description').isRequired);
    assert(p('unit').instance === 'String' && p('unit').isRequired);
    for (const k of ['openingRate', 'currentRate', 'openingQuantity', 'minimumQuantity']) assert(p(k).instance === 'Number' && p(k).options.min === 0, k);
    assert(p('currentQuantity').instance === 'Number'); // signed: OUT beyond stock is allowed by spec
    assert(Material.schema.virtuals.stockValue && Material.schema.virtuals.status);
  });

  const lid = 'MAT001';
  const mat1 = await h.newMaterial(lid, { description: 'Cement', unit: 'Bags', minimumQuantity: 50 });
  await t('R1 §6 ledger example reproduced exactly through the API', async () => {
    const steps = [['2026-09-17', 'IN', 100, 400, 40000, 100], ['2026-09-18', 'IN', 50, 400, 20000, 150], ['2026-09-18', 'OUT', 30, undefined, 12000, 120], ['2026-09-19', 'OUT', 20, undefined, 8000, 100]];
    for (const [d, type, qty, rate, amount, bal] of steps) {
      const r = await h.move(mat1, type, qty, rate, { movementDate: d }); is(r, 201);
      assert.strictEqual(r.b.movement.amount, amount, `${type} ${qty} amount`);
      assert.strictEqual(r.b.movement.balanceAfter, bal, `${type} ${qty} balance`);
      assert.strictEqual(r.b.movement.rate, 400);
      assert.strictEqual(r.b.material.currentQuantity, bal);
    }
    const l = (await call('GET', `/movements?material=${mat1}`, undefined, U)).b;
    assert.deepStrictEqual(l.map((m) => [m.movementDate.slice(0, 10), m.material.materialId, m.type, m.quantity, m.rate, m.amount, m.balanceAfter]), [
      ['2026-09-17', 'MAT001', 'IN', 100, 400, 40000, 100], ['2026-09-18', 'MAT001', 'IN', 50, 400, 20000, 150],
      ['2026-09-18', 'MAT001', 'OUT', 30, 400, 12000, 120], ['2026-09-19', 'MAT001', 'OUT', 20, 400, 8000, 100]]);
  });

  await t('R1 §7 dashboard example reproduced via the dashboard endpoint', async () => {
    is(await h.move(mat1, 'IN', 20, 400, { movementDate: '2026-09-20' }), 201); // MAT001 -> 120 @ 400
    const steel = await h.newMaterial('MAT002', { description: 'Steel Rod', unit: 'Nos', openingQuantity: 15, openingRate: 650, minimumQuantity: 20 });
    const bricks = await h.newMaterial('MAT003', { description: 'Bricks', unit: 'Nos', minimumQuantity: 10 });
    is(await h.move(bricks, 'IN', 10, 8), 201); is(await h.move(bricks, 'OUT', 10), 201); // 0 Nos @ 8
    const d = (await call('GET', '/reports/dashboard', undefined, U)).b;
    const by = Object.fromEntries(d.materials.map((m) => [m.materialId, m]));
    assert.deepStrictEqual([by.MAT001.description, by.MAT001.currentQuantity, by.MAT001.unit, by.MAT001.currentRate, by.MAT001.stockValue, by.MAT001.status], ['Cement', 120, 'Bags', 400, 48000, 'AVAILABLE']);
    assert.deepStrictEqual([by.MAT002.description, by.MAT002.currentQuantity, by.MAT002.unit, by.MAT002.currentRate, by.MAT002.stockValue, by.MAT002.status], ['Steel Rod', 15, 'Nos', 650, 9750, 'LOW_STOCK']);
    assert.deepStrictEqual([by.MAT003.description, by.MAT003.currentQuantity, by.MAT003.unit, by.MAT003.currentRate, by.MAT003.stockValue, by.MAT003.status], ['Bricks', 0, 'Nos', 8, 0, 'OUT_OF_STOCK']);
    assert.strictEqual(d.totalStockValue, 57750); assert.strictEqual(d.lowStockCount, 1); assert.strictEqual(d.outOfStockCount, 1);
  });

  await t('R1 §5 status boundaries via real API (qty == min, min+epsilon, 0, negative, min=0)', async () => {
    const mk = async (id, qty, min) => (await call('POST', '/materials', { materialId: id, description: 'b', unit: 'u', openingQuantity: qty, openingRate: 1, minimumQuantity: min }, A)).b.status;
    assert.strictEqual(await mk('B1', 50, 50), 'LOW_STOCK');           // qty == min  -> LOW (<=)
    assert.strictEqual(await mk('B2', 50.0001, 50), 'AVAILABLE');     // just above
    assert.strictEqual(await mk('B3', 49.9999, 50), 'LOW_STOCK');     // just below
    assert.strictEqual(await mk('B4', 0, 50), 'OUT_OF_STOCK');        // qty == 0
    assert.strictEqual(await mk('B5', 0, 0), 'OUT_OF_STOCK');         // zero beats "<= min"
    assert.strictEqual(await mk('B6', 1, 0), 'AVAILABLE');            // min 0, has stock
    assert.strictEqual(await mk('B7', 0.0001, 0), 'AVAILABLE');
    const m = await h.newMaterial('B8', { minimumQuantity: 5 });
    await h.move(m, 'IN', 5, 1);
    assert.strictEqual((await call('GET', `/materials/${m}`, undefined, U)).b.status, 'LOW_STOCK');   // reached exactly min by movement
    await h.move(m, 'RETURN', 0.0001, undefined);
    assert.strictEqual((await call('GET', `/materials/${m}`, undefined, U)).b.status, 'AVAILABLE');   // 5.0001
    await h.move(m, 'OUT', 5.0001);
    assert.strictEqual((await call('GET', `/materials/${m}`, undefined, U)).b.status, 'OUT_OF_STOCK'); // exactly 0 after float math
    await h.move(m, 'OUT', 1);
    assert.strictEqual((await call('GET', `/materials/${m}`, undefined, U)).b.status, 'OUT_OF_STOCK'); // negative
  });

  await t('R1 §4 formulas: amount=qty*rate, stock=prev+IN-OUT+RETURN, value=qty*rate (random mixed sequence vs oracle)', async () => {
    const m = await h.newMaterial('FORM1', { openingQuantity: 37, openingRate: 12.5 });
    let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 25; i++) {
      const type = ['IN', 'OUT', 'RETURN'][Math.floor(rnd() * 3)];
      const q = Math.round((1 + rnd() * 40) * 100) / 100, rate = Math.round((5 + rnd() * 50) * 100) / 100;
      const r = await h.move(m, type, q, type === 'IN' ? rate : undefined, { movementDate: `2026-05-${String(1 + i).padStart(2, '0')}` }); is(r, 201);
    }
    const mat = (await call('GET', `/materials/${m}`, undefined, U)).b;
    const ms = sorted((await call('GET', `/movements?material=${m}`, undefined, U)).b);
    const o = oracle({ qty: 37, rate: 12.5 }, ms);
    ms.forEach((mv, i) => {
      near(mv.amount, mv.quantity * mv.rate, 0.006);       // Movement Amount = Qty x Rate
      near(mv.balanceAfter, o.rows[i].bal, 0.001);         // Current Stock chain
    });
    near(mat.currentQuantity, o.qty, 0.001); near(mat.currentRate, o.rate, 0.0001);
    near(mat.stockValue, mat.currentQuantity * mat.currentRate, 0.0001); // Stock Value = qty x rate
  });

  // ============================================================ ROUND 2: security
  const victimTok = (async () => {
    const s = await call('POST', '/auth/signup', { name: 'Victim', email: 'victim@test.com', password: 'secret1' });
    await call('PATCH', `/users/${s.b.id}/approve`, undefined, A);
    const tok = (await call('POST', '/auth/login', { email: 'victim@test.com', password: 'secret1' })).token;
    await h.User.deleteOne({ _id: s.b.id });
    return tok;
  })();
  const pendingId = (await call('POST', '/auth/signup', { name: 'Pending', email: 'pend@test.com', password: 'secret1' })).b.id;
  const someMv = (await call('GET', `/movements?material=${mat1}`, undefined, U)).b[0]._id;
  const goodBody = { materialId: 'ZZ1', description: 'd', unit: 'u' };

  const endpoints = [
    ['GET', '/auth/me'], ['GET', '/users'], ['PATCH', `/users/${pendingId}/approve`], ['PATCH', `/users/${pendingId}/reject`],
    ['PATCH', `/users/${pendingId}/role`, { role: 'admin' }], ['GET', '/materials'], ['GET', `/materials/${mat1}`],
    ['POST', '/materials', goodBody], ['PUT', `/materials/${mat1}`, { description: 'hacked' }],
    ['PATCH', `/materials/${mat1}/deactivate`], ['PATCH', `/materials/${mat1}/reactivate`],
    ['GET', '/movements'], ['POST', '/movements', { material: mat1, type: 'IN', quantity: 1, rate: 1 }], ['PUT', `/movements/${someMv}`, { note: 'hacked' }],
    ['GET', '/reports/dashboard'], ['GET', '/reports/stock-value/excel'], ['GET', '/reports/stock-value/pdf'], ['GET', '/reports/movements/excel'],
  ];
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  await t('R2 every protected endpoint rejects: none / malformed / expired / deleted-user / tampered / wrong-secret / alg=none (401), state untouched', async () => {
    const dead = await victimTok;
    const [hd, , sig] = U.split('.');
    const ck = (v) => ({ Cookie: 'token=' + v });
    const creds = {
      'no credentials': {}, 'empty cookie': { Cookie: 'token=' }, 'cookie "null"': ck('null'), 'garbage cookie': ck('a.b.c'),
      'valid JWT in Authorization header only (header is ignored now)': { Authorization: 'Bearer ' + U },
      'valid JWT under the wrong cookie name': { Cookie: 'jwt=' + U },
      'expired': ck(jwt.sign({ id: bobId }, process.env.JWT_SECRET, { expiresIn: -60 })),
      'deleted user': ck(dead),
      'payload tampered (role=admin, real sig)': ck(`${hd}.${b64({ id: bobId, role: 'admin', exp: 4102444800 })}.${sig}`),
      'wrong-secret admin': ck(jwt.sign({ id: adminId, role: 'admin' }, 'not-the-secret')),
      'alg=none': ck(`${b64({ alg: 'none', typ: 'JWT' })}.${b64({ id: adminId, role: 'admin' })}.`),
      'HS512 with right secret': ck(jwt.sign({ id: adminId, role: 'admin' }, process.env.JWT_SECRET, { algorithm: 'HS512' })),
    };
    const jobs = [];
    for (const [k, v] of Object.entries(creds)) for (const [method, path, body] of endpoints) jobs.push({ k, method, path, body, v });
    const res = await inChunks(jobs, (j) => raw(j.method, j.path, { headers: { 'Content-Type': 'application/json', ...j.v }, body: j.body ? JSON.stringify(j.body) : undefined }), 12);
    const bad = res.map((r, i) => [r, jobs[i]]).filter(([r]) => r.s !== 401).map(([r, j]) => `${j.k} ${j.method} ${j.path} -> ${r.s}`);
    assert.deepStrictEqual(bad, []);
    assert.strictEqual((await h.User.findById(pendingId)).status, 'pending');
    assert.strictEqual((await Material.findById(mat1)).description, 'Cement');
    assert(!(await Material.exists({ materialId: 'ZZ1' })));
  });

  await t('R2 normal user: every admin-only action -> 403, nothing changed', async () => {
    const adminOnly = [
      ['POST', '/materials', goodBody], ['PUT', `/materials/${mat1}`, { description: 'hacked' }],
      ['PATCH', `/materials/${mat1}/deactivate`], ['PATCH', `/materials/${mat1}/reactivate`],
      ['PUT', `/movements/${someMv}`, { quantity: 999 }], ['PATCH', `/users/${pendingId}/approve`], ['PATCH', `/users/${pendingId}/reject`],
      ['PATCH', `/users/${pendingId}/role`, { role: 'admin' }], ['PATCH', `/users/${bobId}/role`, { role: 'admin' }], ['GET', '/users'],
    ];
    for (const [m, p, b] of adminOnly) is(await call(m, p, b, U), 403);
    const u = await h.User.findById(bobId); assert.strictEqual(u.role, 'user');
    assert.strictEqual((await h.User.findById(pendingId)).status, 'pending');
    assert.strictEqual((await Movement.findById(someMv)).quantity, 100);
    const mm = await Material.findById(mat1); assert(mm.isActive && mm.description === 'Cement');
  });
  await t('R2 admin cannot change own role even with upper-cased id', async () => is(await call('PATCH', `/users/${adminId.toUpperCase()}/role`, { role: 'user' }, A), 400));

  await t('R2 NoSQL injection in login/signup/query strings never authenticates and never 5xx', async () => {
    const bodies = [
      { email: { $ne: null }, password: { $ne: null } }, { email: { $gt: '' }, password: 'x' }, { email: { $regex: '.*' }, password: 'x' },
      { email: process.env.ADMIN1_EMAIL, password: { $ne: '' } }, { email: [process.env.ADMIN1_EMAIL], password: 'x' },
      { email: process.env.ADMIN1_EMAIL, password: [process.env.ADMIN1_PASSWORD] }, { email: '{"$ne":null}', password: 'x' },
      { email: "admin@x.com' || '1'=='1", password: 'x' }, { email: true, password: true }, { email: null, password: null }, {},
    ];
    for (const b of bodies) { const r = await call('POST', '/auth/login', b); assert(r.s === 400 || r.s === 401, JSON.stringify(b) + ' -> ' + r.s); assert(!r.b || !r.b.token); }
    for (const b of [{ name: { $ne: 1 }, email: 'a@b.com', password: 'secret1' }, { name: 'n', email: { $ne: 1 }, password: 'secret1' }, { name: 'n', email: 'a@b.com', password: { $ne: 1 } }])
      is(await call('POST', '/auth/signup', b), 400);
    for (const q of ['/users?status[$ne]=x', '/users?status=a&status=b', '/movements?material[$ne]=1', '/movements?material=a&material=b', '/materials?active[$ne]=true', '/reports/movements/excel?material[$gt]=1', '/reports/movements/excel?from=a&from=b'])
      ok5(await call('GET', q, undefined, A, true), q);
  });

  await t('R2 XSS/formula payloads are stored inert; exports keep them as plain text; no crash', async () => {
    const payloads = ['<script>alert(1)</script>', '<img src=x onerror=alert(1)>', '"><svg/onload=alert(1)>', '=cmd|" /C calc"!A0', '@SUM(1+1)', "'; DROP TABLE x;--"];
    for (let i = 0; i < payloads.length; i++) {
      const r = await call('POST', '/materials', { materialId: `XSS${i}`, description: payloads[i], unit: 'u' }, A); is(r, 201);
      assert.strictEqual(r.b.description, payloads[i]);
      const mv = await h.move(r.b._id, 'IN', 1, 1, { note: payloads[i] }); is(mv, 201);
    }
    const res = await call('GET', '/reports/stock-value/excel', undefined, U, true);
    assert(/application\/vnd/.test(res.headers.get('content-type')) && res.headers.get('x-content-type-options') === 'nosniff');
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(res.buf);
    const cells = wb.worksheets[0].getColumn(2).values.filter((v) => typeof v === 'string' || (v && typeof v === 'object'));
    const formula = cells.filter((v) => typeof v === 'object');
    assert.deepStrictEqual(formula, [], 'a description became an Excel formula');
    assert(cells.includes('=cmd|" /C calc"!A0'));
    const pdf = await call('GET', '/reports/stock-value/pdf', undefined, U, true); is(pdf, 200);
    assert(pdfText(pdf.buf).includes('<script>alert(1)</script>'));
  });

  await t('R2 oversized strings (10001+ chars) in every text field -> 400, nothing stored', async () => {
    const big = 'x'.repeat(10001);
    const cases = [
      ['POST', '/auth/signup', { name: big, email: 'o1@x.com', password: 'secret1' }], ['POST', '/auth/signup', { name: 'n', email: big + '@x.com', password: 'secret1' }],
      ['POST', '/auth/signup', { name: 'n', email: 'o2@x.com', password: big }], ['POST', '/auth/login', { email: big + '@x.com', password: 'x' }], ['POST', '/auth/login', { email: 'a@b.com', password: big }],
      ['POST', '/materials', { ...goodBody, materialId: big }, A], ['POST', '/materials', { ...goodBody, description: big }, A], ['POST', '/materials', { ...goodBody, unit: big }, A],
      ['PUT', `/materials/${mat1}`, { description: big }, A], ['PUT', `/materials/${mat1}`, { unit: big }, A],
      ['POST', '/movements', { material: mat1, type: 'OUT', quantity: 1, note: big }, U], ['PUT', `/movements/${someMv}`, { note: big }, A],
      ['GET', '/materials/' + big, undefined, A], ['PATCH', `/users/${big}/approve`, undefined, A],
    ];
    for (const [m, p, b, tok] of cases) { const r = await call(m, p, b, tok); assert(r.s === 400, `${m} ${p.slice(0, 30)} -> ${r.s}`); }
    assert(!(await Material.exists({ description: big })) && !(await h.User.exists({ email: /^o[12]@/ })));
    // exactly-at-limit still fine
    is(await call('POST', '/materials', { materialId: 'L'.repeat(50), description: 'd'.repeat(200), unit: 'u'.repeat(30) }, A), 201);
  });

  const BAD_NUMS = [-1, 'NaN', 'Infinity', '-Infinity', null, '', ' ', true, false, [], [1, 2], [5], {}, { $gt: 0 }, '1e999', '1e400', 1e10, 1e15, '0x10', '1,5', '5abc', 'abc', '--5', '9'.repeat(10000)];
  await t('R2 negative/NaN/Infinity/null/wrong-type/huge in every numeric field -> 400 (no 5xx, nothing stored)', async () => {
    const seen = [];
    const mvTarget = await h.newMaterial('NUMT');
    const jobs = [];
    for (const v of BAD_NUMS) {
      for (const f of ['openingRate', 'openingQuantity', 'minimumQuantity']) {
        jobs.push({ label: `create ${f}=${JSON.stringify(v).slice(0, 20)}`, run: () => call('POST', '/materials', { materialId: 'BADNUM', description: 'd', unit: 'u', [f]: v }, A) });
        jobs.push({ label: `update ${f}=${JSON.stringify(v).slice(0, 20)}`, run: () => call('PUT', `/materials/${mvTarget}`, { [f]: v }, A) });
      }
      jobs.push({ label: `mv IN quantity=${JSON.stringify(v)?.slice(0, 20)}`, run: () => call('POST', '/movements', { material: mvTarget, type: 'IN', quantity: v, rate: 5 }, U) });
      jobs.push({ label: `mv OUT quantity=${JSON.stringify(v)?.slice(0, 20)}`, run: () => call('POST', '/movements', { material: mvTarget, type: 'OUT', quantity: v }, U) });
      jobs.push({ label: `mv IN rate=${JSON.stringify(v)?.slice(0, 20)}`, run: () => call('POST', '/movements', { material: mvTarget, type: 'IN', quantity: 1, rate: v }, U) });
      jobs.push({ label: `mv IN enteredRate=${JSON.stringify(v)?.slice(0, 20)}`, run: () => call('POST', '/movements', { material: mvTarget, type: 'IN', quantity: 1, enteredRate: v }, U) });
      jobs.push({ label: `edit quantity=${JSON.stringify(v)?.slice(0, 20)}`, run: () => call('PUT', `/movements/${someMv}`, { quantity: v }, A) });
      jobs.push({ label: `edit enteredRate=${JSON.stringify(v)?.slice(0, 20)}`, run: () => call('PUT', `/movements/${someMv}`, { enteredRate: v }, A) });
    }
    // also: 0 and sub-minimum quantity, omitted required fields
    jobs.push({ label: 'qty 0', run: () => call('POST', '/movements', { material: mvTarget, type: 'RETURN', quantity: 0 }, U) });
    jobs.push({ label: 'qty 0.00001', run: () => call('POST', '/movements', { material: mvTarget, type: 'RETURN', quantity: 0.00001 }, U) });
    jobs.push({ label: 'qty omitted', run: () => call('POST', '/movements', { material: mvTarget, type: 'RETURN' }, U) });
    jobs.push({ label: 'IN rate omitted', run: () => call('POST', '/movements', { material: mvTarget, type: 'IN', quantity: 1 }, U) });
    const res = await inChunks(jobs, (j) => j.run(), 10);
    res.forEach((r, i) => { if (r.s !== 400) seen.push(`${jobs[i].label} -> ${r.s}`); });
    assert.deepStrictEqual(seen, []);
    assert(!(await Material.exists({ materialId: 'BADNUM' })));
    assert.strictEqual(await Movement.countDocuments({ material: mvTarget }), 0);
  });
  await t('R2 accepted numeric strings/edges behave (numeric string, 1e9 limit, leading/trailing space, 1e-4)', async () => {
    const m = await h.newMaterial('NUMOK');
    is(await h.move(m, 'IN', '2.5', '4'), 201);
    is(await h.move(m, 'IN', ' 1 ', ' 1 '), 201);
    is(await h.move(m, 'IN', 1e9, 1e9), 201);      // the documented upper limit
    is(await h.move(m, 'IN', 0.0001, 0), 201);     // lower limits
    is(await h.move(m, 'IN', 1e9 + 1, 1), 400);
  });
  await t('R2 no NaN/Infinity/null numbers anywhere in the database after all the abuse', async () => {
    const bad = [];
    for (const d of await Material.find().lean()) for (const k of ['openingRate', 'openingQuantity', 'minimumQuantity', 'currentQuantity', 'currentRate']) if (!Number.isFinite(d[k])) bad.push(`${d.materialId}.${k}=${d[k]}`);
    for (const d of await Movement.find().lean()) for (const k of ['quantity', 'rate', 'amount', 'balanceAfter']) if (!Number.isFinite(d[k])) bad.push(`mv ${d._id}.${k}=${d[k]}`);
    assert.deepStrictEqual(bad, []);
  });

  const IDS = ['xyz', '123', 'a'.repeat(24), 'A'.repeat(24), '0'.repeat(24), 'abcdefghijkl', '..%2Fetc', '%2e%2e', '%zz', '%00', encodeURIComponent('{"$ne":1}'), 'x'.repeat(5000), 'null', 'undefined', '%5Bobject%20Object%5D', '%20', 'ü', '%F0%9F%92%A9', 'g'.repeat(24)];
  await t('R2 malformed :id on every id route -> clean 400/404 JSON, never 5xx', async () => {
    const routes = [['GET', (i) => `/materials/${i}`], ['PUT', (i) => `/materials/${i}`, { description: 'x' }], ['PATCH', (i) => `/materials/${i}/deactivate`], ['PATCH', (i) => `/materials/${i}/reactivate`],
      ['PUT', (i) => `/movements/${i}`, { note: 'x' }], ['PATCH', (i) => `/users/${i}/approve`], ['PATCH', (i) => `/users/${i}/reject`], ['PATCH', (i) => `/users/${i}/role`, { role: 'user' }]];
    const jobs = []; for (const [m, p, b] of routes) for (const id of IDS) jobs.push([m, p(id), b]);
    const res = await inChunks(jobs, ([m, p, b]) => raw(m, p, { headers: { 'Content-Type': 'application/json', Cookie: 'token=' + A }, body: b ? JSON.stringify(b) : undefined }), 10);
    const bad = res.map((r, i) => [r, jobs[i]]).filter(([r]) => ![400, 404].includes(r.s) || !r.b || !r.b.message).map(([r, j]) => `${j[0]} ${j[1].slice(0, 45)} -> ${r.s}`);
    assert.deepStrictEqual(bad, []);
    // empty id segment: falls through to a JSON 404 (or the list route), not a crash
    for (const [m, p] of [['PUT', '/materials/'], ['PATCH', '//deactivate'], ['PATCH', '/materials//deactivate'], ['PUT', '/movements/']]) ok5(await raw(m, p, { headers: { Cookie: 'token=' + A, 'Content-Type': 'application/json' }, body: '{}' }), m + p);
    for (const q of ['/movements?material=', '/movements?material=%zz', '/reports/movements/excel?material=&from=&to=', '/reports/movements/excel?material=xyz', '/movements?material=' + 'x'.repeat(5000)]) ok5(await raw('GET', q, { headers: { Cookie: 'token=' + A } }), q);
  });
  await t('R2 array/object/wrong-case ids in request BODIES are rejected or normalised (400/404/201, no 5xx)', async () => {
    const m = await h.newMaterial('IDB1');
    for (const v of [[m], { $ne: 1 }, 123, true, null, '', 'nope']) is(await call('POST', '/movements', { material: v, type: 'IN', quantity: 1, rate: 1 }, U), 400);
    is(await call('POST', '/movements', { material: m.toUpperCase(), type: 'IN', quantity: 1, rate: 1 }, U), 201); // same id, upper-case hex
    for (const v of [['IN'], { a: 1 }, 5, null, 'in', 'XX', '']) is(await call('POST', '/movements', { material: m, type: v, quantity: 1, rate: 1 }, U), 400);
    for (const v of [['n'], { a: 1 }, 5, true]) is(await call('POST', '/movements', { material: m, type: 'OUT', quantity: 1, note: v }, U), 400);
    for (const v of [['2026-01-01'], {}, 5, 'yesterday', '1969-12-31', '2101-01-01', '+275760-09-13T00:00:00.000Z']) is(await call('POST', '/movements', { material: m, type: 'OUT', quantity: 1, movementDate: v }, U), 400);
  });

  await t('R2 HTTP edge cases: bad URI 400, oversize body 413, invalid JSON 400, wrong content-type / empty body 4xx, no 5xx', async () => {
    is({ s: (await raw('GET', '/materials/%zz', { headers: { Cookie: 'token=' + A } })).s }, 400);
    is({ s: (await raw('POST', '/auth/login', { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'a@b.com', password: 'x'.repeat(300000) }) })).s }, 413);
    is({ s: (await raw('POST', '/auth/login', { headers: { 'Content-Type': 'application/json' }, body: '{bad' })).s }, 400);
    for (const ct of ['text/plain', 'application/x-www-form-urlencoded', undefined]) {
      const r = await raw('POST', '/auth/login', { headers: ct ? { 'Content-Type': ct } : {}, body: 'email=a@b.com&password=x' }); assert(r.s === 400, `content-type ${ct} -> ${r.s}`);
    }
    for (const [m, p] of [['PATCH', `/users/${pendingId}/role`], ['PATCH', `/users/${pendingId}/approve`], ['PUT', `/materials/${mat1}`], ['PUT', `/movements/${someMv}`], ['POST', '/movements'], ['POST', '/materials']])
      ok5(await raw(m, p, { headers: { Cookie: 'token=' + A } }), `${m} ${p} with no body`);
    const r = await raw('GET', '/nope/nothing', { headers: {} }); is(r, 404);
    assert.strictEqual((await raw('GET', '/health')).s, 200);
  });

  await t('R2 login timing: unknown email is not distinguishable by an obvious margin from wrong password', async () => {
    const time = async (email) => { const s = process.hrtime.bigint(); await call('POST', '/auth/login', { email, password: 'wrongpass' }); return Number(process.hrtime.bigint() - s) / 1e6; };
    await time('warm@x.com');
    const known = [], unknown = [];
    for (let i = 0; i < 5; i++) { known.push(await time('bob@test.com')); unknown.push(await time(`ghost${i}@test.com`)); }
    const med = (a) => a.sort((x, y) => x - y)[2];
    assert(med(unknown) > med(known) * 0.5, `unknown ${med(unknown).toFixed(0)}ms vs known ${med(known).toFixed(0)}ms`); // pre-fix: ~10x faster
  });

  // ---------- concurrency ----------
  const chainOk = async (matId, label) => {
    const mat = (await call('GET', `/materials/${matId}`, undefined, U)).b;
    const list = (await call('GET', `/movements?material=${matId}`, undefined, U)).b;
    const ms = sorted(list);
    assert.deepStrictEqual(list.map((m) => m._id), ms.map((m) => m._id), label + ': API order != (date, createdAt, _id)');
    const o = oracle({ qty: mat.openingQuantity, rate: mat.openingRate }, ms);
    ms.forEach((mv, i) => {
      const w = o.rows[i], id = `${label} #${i + 1} ${mv.type}`;
      near(mv.balanceAfter, w.bal, 0.002); near(mv.rate, w.rate, Math.max(1e-4, Math.abs(w.rate) * 1e-6)); near(mv.amount, w.amount, 0.011);
      assert.strictEqual(mv.exceededStock, w.ex, id + ' exceededStock');
      if (mv.type === 'IN') assert(mv.enteredRate !== null && Math.abs(mv.enteredRate - mv.rate) < 1e-9, id + ' enteredRate != rate paid'); else assert.strictEqual(mv.enteredRate, null, id + ' enteredRate');
    });
    near(mat.currentQuantity, o.qty, 0.002); near(mat.currentRate, o.rate, Math.max(1e-4, Math.abs(o.rate) * 1e-6));
    if (ms.length) { const last = ms[ms.length - 1]; near(mat.currentQuantity, last.balanceAfter, 0.0001); if (last.type !== 'IN') near(mat.currentRate, last.rate, 1e-5); }
    return { mat, ms };
  };

  await t('R2 20 simultaneous OUTs on one material: exact final balance, no lost updates', async () => {
    const m = await h.newMaterial('CONC20');
    is(await h.move(m, 'IN', 1000, 10, { movementDate: '2026-01-01' }), 201);
    const res = await Promise.all(Array.from({ length: 20 }, (_, i) => h.move(i % 2 ? m.toUpperCase() : m, 'OUT', 1, undefined, {}, i % 3 ? U : A)));
    res.forEach((r) => is(r, 201));
    const { mat, ms } = await chainOk(m, 'conc20');
    assert.strictEqual(mat.currentQuantity, 980);
    assert.deepStrictEqual(ms.slice(1).map((x) => x.balanceAfter).sort((a, b) => b - a), Array.from({ length: 20 }, (_, i) => 999 - i)); // every balance 999..980 exactly once
    assert(ms.slice(1).every((x) => x.rate === 10 && x.amount === 10));
  });
  await t('R2 heavy mixed concurrency (OUT/IN/RETURN + back-dated + edits at once): whole chain still exact', async () => {
    const m = await h.newMaterial('CONCMIX', { openingQuantity: 500, openingRate: 20 });
    const first = (await h.move(m, 'IN', 100, 25, { movementDate: '2026-02-01' })).b.movement._id;
    const second = (await h.move(m, 'IN', 50, 30, { movementDate: '2026-02-02' })).b.movement._id;
    const jobs = [];
    for (let i = 0; i < 20; i++) jobs.push(() => h.move(m, 'OUT', 1 + (i % 4), undefined, { movementDate: `2026-02-${String(3 + (i % 9)).padStart(2, '0')}` }));
    for (let i = 0; i < 8; i++) jobs.push(() => h.move(m, 'IN', 5 + i, 10 + i, { movementDate: `2026-02-${String(1 + (i % 10)).padStart(2, '0')}` })); // some back-dated
    for (let i = 0; i < 6; i++) jobs.push(() => h.move(m, 'RETURN', 2, undefined, { movementDate: `2026-02-${String(4 + i).padStart(2, '0')}` }));
    jobs.push(() => call('PUT', `/movements/${first}`, { quantity: 140 }, A), () => call('PUT', `/movements/${second}`, { enteredRate: 33 }, A), () => call('PUT', `/movements/${first}`, { note: 'x' }, A));
    const res = await Promise.all(jobs.map((j) => j()));
    res.forEach((r, i) => assert([200, 201].includes(r.s), `job ${i} -> ${r.s} ${JSON.stringify(r.b)}`));
    await chainOk(m, 'concmix');
  });
  await t('R2 opening-value edit racing a movement never leaves inconsistent stock', async () => {
    for (let round = 0; round < 3; round++) {
      const m = await h.newMaterial(`RACE${round}`, { openingQuantity: 10, openingRate: 5 });
      const rs = await Promise.all([call('PUT', `/materials/${m}`, { openingQuantity: 77, openingRate: 9 }, A), h.move(m, 'IN', 5, 8), call('PUT', `/materials/${m}`, { openingQuantity: 55 }, A)]);
      rs.forEach((r) => assert([200, 201, 409].includes(r.s), `race -> ${r.s}`));
      await chainOk(m, 'race' + round);
    }
  });

  // ============================================================ ROUND 3: integrity under chaos
  const enteredSent = new Map();
  const r3 = await h.newMaterial('R3CHAOS', { description: 'Chaos', unit: 'Nos', openingQuantity: 50, openingRate: 10, minimumQuantity: 20 });
  const spec = [['2026-03-10', 'IN', 100, 12], ['2026-03-05', 'OUT', 30], ['2026-03-20', 'IN', 40, 9], ['2026-03-01', 'RETURN', 5], ['2026-03-15', 'OUT', 200], ['2026-03-12', 'IN', 60, 15],
    ['2026-03-25', 'RETURN', 10], ['2026-03-08', 'OUT', 20], ['2026-03-18', 'IN', 25, 11], ['2026-03-22', 'OUT', 15], ['2026-03-03', 'IN', 10, 20], ['2026-03-28', 'OUT', 5],
    ['2026-03-14', 'RETURN', 12], ['2026-03-30', 'IN', 50, 10], ['2026-03-11', 'OUT', 40], ['2026-03-27', 'IN', 8, 13], ['2026-03-10', 'OUT', 3], ['2026-03-10', 'IN', 7, 14], ['2026-03-31', 'OUT', 7]];
  const ids = [];
  await t(`R3 ${spec.length} movements inserted out of order (incl. same-day ties): chain exact after EVERY insert`, async () => {
    for (const [d, type, q, rate] of spec) {
      const r = await h.move(r3, type, q, rate, { movementDate: d }); is(r, 201);
      ids.push(r.b.movement._id); if (type === 'IN') enteredSent.set(r.b.movement._id, rate);
      await chainOk(r3, `insert ${ids.length}`);
    }
    const { ms } = await chainOk(r3, 'all');
    assert.strictEqual(ms.length, spec.length);
    assert(ms.some((m) => m.exceededStock) && ms.some((m) => m.balanceAfter < 0), 'scenario should include negative stock');
  });

  const beforeEnteredCheck = async (label, editedId) => {
    const { ms } = await chainOk(r3, label);
    for (const m of ms) {
      if (m.type === 'IN') assert.strictEqual(m.enteredRate, enteredSent.get(m._id), `${label}: enteredRate of ${m._id} corrupted`);
      assert.strictEqual(m.isEdited, editedSet.has(m._id), `${label}: isEdited flag on ${m._id}`);
    }
    assert(ms.find((m) => m._id === editedId));
    return ms;
  };
  const editedSet = new Set();
  const mid = ids[spec.findIndex(([d, t2]) => d === '2026-03-10' && t2 === 'IN')]; // first 03-10 IN = middle of history
  await t('R3 edit #1 (middle IN quantity 100 -> 150): every balance/rate/enteredRate/current still exact', async () => {
    is(await call('PUT', `/movements/${mid}`, { quantity: 150 }, A), 200); editedSet.add(mid);
    await beforeEnteredCheck('edit1', mid);
  });
  await t('R3 edit #2 (same movement rate 12 -> 18)', async () => {
    is(await call('PUT', `/movements/${mid}`, { enteredRate: 18 }, A), 200); enteredSent.set(mid, 18);
    await beforeEnteredCheck('edit2', mid);
  });
  await t('R3 edit #3 (same movement moved to an earlier date + note)', async () => {
    is(await call('PUT', `/movements/${mid}`, { movementDate: '2026-03-02', note: 'moved' }, A), 200);
    const ms = await beforeEnteredCheck('edit3', mid);
    assert.strictEqual(ms.find((m) => m._id === mid).movementDate.slice(0, 10), '2026-03-02');
  });
  await t('R3 edit #4 (a different movement: OUT -> IN with a rate) and #5 (IN -> RETURN, rate dropped)', async () => {
    const outId = ids[spec.findIndex(([d, t2, q]) => d === '2026-03-15' && t2 === 'OUT' && q === 200)];
    is(await call('PUT', `/movements/${outId}`, { type: 'IN', enteredRate: 7 }, A), 200); editedSet.add(outId); enteredSent.set(outId, 7);
    await beforeEnteredCheck('edit4', outId);
    is(await call('PUT', `/movements/${outId}`, { type: 'RETURN' }, A), 200); enteredSent.delete(outId);
    const ms = await beforeEnteredCheck('edit5', outId);
    assert.strictEqual(ms.find((m) => m._id === outId).enteredRate, null);
  });
  await t('R3 no-op edit keeps everything identical', async () => {
    const before = (await call('GET', `/movements?material=${r3}`, undefined, U)).b, mat0 = (await call('GET', `/materials/${r3}`, undefined, U)).b;
    is(await call('PUT', `/movements/${mid}`, {}, A), 200);
    assert.deepStrictEqual((await call('GET', `/movements?material=${r3}`, undefined, U)).b.map((m) => [m._id, m.rate, m.amount, m.balanceAfter, m.isEdited]), before.map((m) => [m._id, m.rate, m.amount, m.balanceAfter, m.isEdited]));
    const mat1b = (await call('GET', `/materials/${r3}`, undefined, U)).b;
    assert(mat1b.currentQuantity === mat0.currentQuantity && mat1b.currentRate === mat0.currentRate);
  });

  await t('R3 deactivating a material with history keeps every movement readable (API list, all-list, export) and editable', async () => {
    is(await call('PATCH', `/materials/${r3}/deactivate`, undefined, A), 200);
    const l = (await call('GET', `/movements?material=${r3}`, undefined, U)).b;
    assert.strictEqual(l.length, spec.length);
    assert(l.every((m) => m.material && m.material.materialId === 'R3CHAOS' && m.createdBy && m.createdBy.name));
    const all = (await call('GET', '/movements', undefined, U)).b;
    assert.strictEqual(all.filter((m) => m.material && m.material.materialId === 'R3CHAOS').length, spec.length);
    const xl = await call('GET', `/reports/movements/excel?material=${r3}`, undefined, U, true);
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(xl.buf); assert.strictEqual(wb.worksheets[0].rowCount, spec.length + 1);
    is(await h.move(r3, 'IN', 1, 1), 404); // no new movements while inactive
    is(await call('PUT', `/movements/${mid}`, { quantity: 160 }, A), 200); // admin correction still works
    await chainOk(r3, 'inactive-edit');
    is(await call('PATCH', `/materials/${r3}/reactivate`, undefined, A), 200);
    is(await h.move(r3, 'RETURN', 1), 201);
    await chainOk(r3, 'reactivated');
  });

  await t('R2/R3 server survived everything: zero unhandled errors, health OK', async () => {
    assert.strictEqual(unhandled, 0);
    assert.strictEqual((await raw('GET', '/health')).s, 200);
  });

  await h.finish();
})().catch((e) => { console.error('harness error:', e); process.exit(1); });
