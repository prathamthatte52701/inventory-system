// Integration tests. Uses a throwaway DB (inventory_test) on the same cluster, dropped at the end.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
process.env.NODE_ENV = 'test';
const assert = require('assert');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const app = require('../app');
const User = require('../models/User');
const Movement = require('../models/Movement');
const AuditLog = require('../models/AuditLog');
const seedAdmins = require('../utils/seedAdmins');

let base, pass = 0, fail = 0;
const t = async (name, fn) => {
  try { await fn(); pass++; } catch (e) { fail++; console.log('FAIL', name, '-', e.message); }
};
const call = async (method, path, body, token) => {
  const r = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Cookie: 'token=' + token } : {}) },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  let json = null;
  try { json = await r.json(); } catch { /* empty */ }
  const sc = (r.headers.getSetCookie ? r.headers.getSetCookie() : []).find((x) => x.startsWith('token='));
  return { s: r.status, b: json, token: sc ? sc.slice(6, sc.indexOf(';')) : undefined };
};
const is = (r, s) => assert.strictEqual(r.s, s, `expected ${s} got ${r.s} ${JSON.stringify(r.b)}`);

(async () => {
  await require('../config/db')({ dbName: 'inventory_test' });
  await mongoose.connection.dropDatabase();
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  const server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}/api`;

  // ---------- Phase 2 brutal ----------
  await t('seed creates both admins', async () => {
    const out = await seedAdmins();
    assert(out.every((l) => l.endsWith('created')), out.join());
    const a = await User.find({ role: 'admin', status: 'approved' }).select('+passwordHash');
    assert.strictEqual(a.length, 2);
    assert(a.every((u) => u.passwordHash && u.passwordHash !== process.env.ADMIN1_PASSWORD && u.passwordHash.startsWith('$2')));
  });
  await t('seed idempotent', async () => {
    const out = await seedAdmins();
    assert(out.every((l) => l.endsWith('skipped')), out.join());
    assert.strictEqual(await User.countDocuments(), 2);
  });

  const admin = await call('POST', '/auth/login', { email: process.env.ADMIN1_EMAIL, password: process.env.ADMIN1_PASSWORD });
  let A;
  await t('admin login ok + JWT payload', async () => {
    is(admin, 200); A = admin.token;
    const p = jwt.verify(A, process.env.JWT_SECRET);
    assert(p.id && p.role === 'admin' && p.exp);
    assert(!JSON.stringify(admin.b).includes('passwordHash'));
  });

  let uid;
  await t('signup -> pending', async () => {
    const r = await call('POST', '/auth/signup', { name: 'Bob', email: 'Bob@Test.com', password: 'secret1' });
    is(r, 201); assert.strictEqual(r.b.status, 'pending'); uid = r.b.id;
    const u = await User.findById(uid).select('+passwordHash');
    assert(u.passwordHash !== 'secret1' && u.passwordHash.startsWith('$2'));
  });
  await t('signup cannot self-assign admin/approved', async () => {
    const r = await call('POST', '/auth/signup', { name: 'Eve', email: 'eve@test.com', password: 'secret1', role: 'admin', status: 'approved' });
    is(r, 201);
    const u = await User.findOne({ email: 'eve@test.com' });
    assert(u.role === 'user' && u.status === 'pending');
  });
  await t('login blocks pending', async () => is(await call('POST', '/auth/login', { email: 'bob@test.com', password: 'secret1' }), 403));
  await t('pending id has no access even w/ forged-valid token', async () => {
    const tok = jwt.sign({ id: uid, role: 'user' }, process.env.JWT_SECRET);
    is(await call('GET', '/materials', undefined, tok), 403);
  });
  await t('admin lists pending users', async () => {
    const r = await call('GET', '/users?status=pending', undefined, A);
    is(r, 200); assert(r.b.length === 2);
    assert(!JSON.stringify(r.b).includes('passwordHash'));
  });
  await t('approve works', async () => {
    const r = await call('PATCH', `/users/${uid}/approve`, undefined, A);
    is(r, 200); assert(r.b.status === 'approved' && r.b.approvedBy && r.b.approvedAt);
  });
  let U;
  await t('login ok after approval', async () => {
    const r = await call('POST', '/auth/login', { email: 'bob@test.com', password: 'secret1' });
    is(r, 200); U = r.token; assert.strictEqual(r.b.user.role, 'user');
  });
  await t('reject flow blocks login', async () => {
    const eve = await User.findOne({ email: 'eve@test.com' });
    is(await call('PATCH', `/users/${eve._id}/reject`, undefined, A), 200);
    is(await call('POST', '/auth/login', { email: 'eve@test.com', password: 'secret1' }), 403);
  });
  await t('login audited', async () => assert(await AuditLog.exists({ action: 'LOGIN', userEmail: 'bob@test.com' })));

  // ---------- Phase 2 break ----------
  await t('wrong password 401', async () => is(await call('POST', '/auth/login', { email: 'bob@test.com', password: 'nope' }), 401));
  await t('unknown email 401 (same as wrong pw)', async () => is(await call('POST', '/auth/login', { email: 'ghost@test.com', password: 'x' }), 401));
  await t('no token 401', async () => is(await call('GET', '/materials'), 401));
  await t('garbage token 401', async () => is(await call('GET', '/materials', undefined, 'abc.def.ghi'), 401));
  await t('tampered token 401', async () => is(await call('GET', '/materials', undefined, U.slice(0, -3) + 'xxx'), 401));
  await t('token signed w/ wrong secret 401', async () => is(await call('GET', '/materials', undefined, jwt.sign({ id: uid }, 'wrong')), 401));
  await t('expired token 401', async () => {
    is(await call('GET', '/materials', undefined, jwt.sign({ id: uid }, process.env.JWT_SECRET, { expiresIn: -10 })), 401);
  });
  await t('alg=none token 401', async () => {
    const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    is(await call('GET', '/materials', undefined, `${b({ alg: 'none', typ: 'JWT' })}.${b({ id: uid, role: 'admin' })}.`), 401);
  });
  await t('role claim in token is ignored (DB role used)', async () => {
    is(await call('GET', '/users', undefined, jwt.sign({ id: uid, role: 'admin' }, process.env.JWT_SECRET)), 403);
  });
  await t('non-admin blocked from admin routes', async () => {
    is(await call('GET', '/users', undefined, U), 403);
    is(await call('PATCH', `/users/${uid}/approve`, undefined, U), 403);
    is(await call('PATCH', `/users/${uid}/reject`, undefined, U), 403);
  });
  await t('double approve -> 409', async () => is(await call('PATCH', `/users/${uid}/approve`, undefined, A), 409));
  await t('approve then reject processed user -> 409', async () => is(await call('PATCH', `/users/${uid}/reject`, undefined, A), 409));
  await t('approve nonexistent -> 404', async () => is(await call('PATCH', `/users/${new mongoose.Types.ObjectId()}/approve`, undefined, A), 404));
  await t('approve malformed id -> 400', async () => is(await call('PATCH', '/users/notanid/approve', undefined, A), 400));
  await t('duplicate email (case-insens) -> 409', async () => is(await call('POST', '/auth/signup', { name: 'X', email: 'BOB@test.com', password: 'secret1' }), 409));
  await t('signup bad email 400', async () => is(await call('POST', '/auth/signup', { name: 'X', email: 'bad', password: 'secret1' }), 400));
  await t('signup short password 400', async () => is(await call('POST', '/auth/signup', { name: 'X', email: 'x@x.com', password: '123' }), 400));
  await t('signup missing fields 400', async () => is(await call('POST', '/auth/signup', {}), 400));
  await t('login NoSQL injection 400', async () => is(await call('POST', '/auth/login', { email: { $gt: '' }, password: { $gt: '' } }), 400));
  await t('malformed JSON 400', async () => is(await call('POST', '/auth/login', '{bad'), 400));
  await t('user revoked after login loses access at once', async () => {
    await User.updateOne({ _id: uid }, { status: 'rejected' });
    is(await call('GET', '/materials', undefined, U), 403);
    await User.updateOne({ _id: uid }, { status: 'approved' });
  });

  // ---------- Phase 3 brutal ----------
  const mat = { materialId: 'mat001', description: 'Cement', unit: 'Bag', openingRate: 400, openingQuantity: 120, minimumQuantity: 50 };
  let mid;
  await t('admin create', async () => {
    const r = await call('POST', '/materials', mat, A);
    is(r, 201); mid = r.b._id;
    assert(r.b.materialId === 'MAT001' && r.b.currentQuantity === 120 && r.b.currentRate === 400);
    assert(r.b.status === 'AVAILABLE' && r.b.stockValue === 48000 && r.b.isActive === true);
  });
  await t('user can list/get', async () => {
    const l = await call('GET', '/materials', undefined, U);
    is(l, 200); assert.strictEqual(l.b.length, 1);
    const g = await call('GET', `/materials/${mid}`, undefined, U);
    is(g, 200); assert.strictEqual(g.b.materialId, 'MAT001');
  });
  await t('admin update (no movements) incl. opening; current syncs', async () => {
    const r = await call('PUT', `/materials/${mid}`, { description: 'OPC Cement', openingQuantity: 10, openingRate: 500, minimumQuantity: 20 }, A);
    is(r, 200);
    assert(r.b.description === 'OPC Cement' && r.b.currentQuantity === 10 && r.b.currentRate === 500 && r.b.status === 'LOW_STOCK');
  });
  await t('deactivate / reactivate', async () => {
    const d = await call('PATCH', `/materials/${mid}/deactivate`, undefined, A);
    is(d, 200); assert.strictEqual(d.b.isActive, false);
    const f = await call('GET', '/materials?active=false', undefined, U);
    assert.strictEqual(f.b.length, 1);
    const r = await call('PATCH', `/materials/${mid}/reactivate`, undefined, A);
    is(r, 200); assert.strictEqual(r.b.isActive, true);
  });
  await t('normal user: all writes 403', async () => {
    is(await call('POST', '/materials', { ...mat, materialId: 'X1' }, U), 403);
    is(await call('PUT', `/materials/${mid}`, { description: 'hack' }, U), 403);
    is(await call('PATCH', `/materials/${mid}/deactivate`, undefined, U), 403);
    is(await call('PATCH', `/materials/${mid}/reactivate`, undefined, U), 403);
    const r = await call('POST', '/materials', mat, U);
    assert(/admin/i.test(r.b.message), 'clear message');
  });

  // ---------- Phase 3 break ----------
  await t('duplicate materialId (case-insens) 409', async () => is(await call('POST', '/materials', { ...mat, materialId: 'Mat001' }, A), 409));
  await t('negative openingQuantity 400', async () => is(await call('POST', '/materials', { ...mat, materialId: 'N1', openingQuantity: -5 }, A), 400));
  await t('negative openingRate 400', async () => is(await call('POST', '/materials', { ...mat, materialId: 'N2', openingRate: -1 }, A), 400));
  await t('negative minimumQuantity 400', async () => is(await call('POST', '/materials', { ...mat, materialId: 'N3', minimumQuantity: -1 }, A), 400));
  await t('non-numeric qty 400', async () => is(await call('POST', '/materials', { ...mat, materialId: 'N4', openingQuantity: 'abc' }, A), 400));
  await t('null qty 400', async () => is(await call('POST', '/materials', { ...mat, materialId: 'N5', openingQuantity: null }, A), 400));
  await t('missing required fields 400', async () => is(await call('POST', '/materials', { openingQuantity: 1 }, A), 400));
  await t('update negative 400', async () => is(await call('PUT', `/materials/${mid}`, { openingRate: -3 }, A), 400));
  await t('update nonexistent 404', async () => is(await call('PUT', `/materials/${new mongoose.Types.ObjectId()}`, { description: 'x' }, A), 404));
  await t('get nonexistent 404', async () => is(await call('GET', `/materials/${new mongoose.Types.ObjectId()}`, undefined, A), 404));
  await t('deactivate nonexistent 404', async () => is(await call('PATCH', `/materials/${new mongoose.Types.ObjectId()}/deactivate`, undefined, A), 404));
  await t('malformed id 400 not crash', async () => {
    is(await call('GET', '/materials/xyz', undefined, A), 400);
    is(await call('PUT', '/materials/xyz', { description: 'x' }, A), 400);
  });
  await t('deactivate already-inactive is fine', async () => {
    is(await call('PATCH', `/materials/${mid}/deactivate`, undefined, A), 200);
    is(await call('PATCH', `/materials/${mid}/deactivate`, undefined, A), 200);
    await call('PATCH', `/materials/${mid}/reactivate`, undefined, A);
  });
  await t('system-maintained fields not writable via API', async () => {
    const r = await call('PUT', `/materials/${mid}`, { currentQuantity: 9999, currentRate: 1, isActive: false, materialId: 'HACK' }, A);
    is(r, 200); assert(r.b.currentQuantity === 10 && r.b.currentRate === 500 && r.b.isActive === true && r.b.materialId === 'MAT001');
    const c = await call('POST', '/materials', { ...mat, materialId: 'C1', currentQuantity: 999, isActive: false }, A);
    assert(c.b.currentQuantity === 120 && c.b.isActive === true);
  });
  await t('opening edit blocked once a Movement exists', async () => {
    await Movement.create({ material: mid, type: 'IN', quantity: 5, rate: 500, amount: 2500, balanceAfter: 15 });
    const a = await call('PUT', `/materials/${mid}`, { openingQuantity: 99 }, A);
    is(a, 409);
    is(await call('PUT', `/materials/${mid}`, { openingRate: 1 }, A), 409);
    const ok = await call('PUT', `/materials/${mid}`, { description: 'Still editable', minimumQuantity: 3 }, A);
    is(ok, 200); assert(ok.b.currentQuantity === 10 && ok.b.openingQuantity === 10);
    is(await call('PUT', `/materials/${mid}`, { openingQuantity: 10 }, A), 200); // unchanged value is not an edit
  });
  await t('no DELETE route: 404, material intact', async () => {
    is(await call('DELETE', `/materials/${mid}`, undefined, A), 404);
    is(await call('GET', `/materials/${mid}`, undefined, A), 200);
  });
  await t('mutations audited', async () => {
    for (const a of ['MATERIAL_CREATE', 'MATERIAL_UPDATE', 'MATERIAL_DEACTIVATE', 'USER_APPROVE']) assert(await AuditLog.exists({ action: a }), a);
  });

  await mongoose.connection.dropDatabase();
  server.close();
  await mongoose.disconnect();
  console.log(`api: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('harness error:', e.message); process.exit(1); });
